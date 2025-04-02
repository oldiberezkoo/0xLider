import launchBrowser from "@/shared/launchBrowser";
import logger from "@/utiles/logger";
import fs from "fs";
import Fuse from "fuse.js";
import natural from "natural";
import path from "path";
import type { Browser, Page } from "puppeteer";
import { createClient } from "redis";
import config from "../variables";

const keywords = config.chunks.filter.keywords.flat();

export interface Results {
  allLinks: string[];
  unavailableLinks: string[];
  keywordMatchedLinks: string[];
  nonMatchedLinks: string[];
  processedLinks: string[];
  processedObjects: AdObject[];
  readyForUse: string[];
  lastUpdated: string;
}

export interface AdObject {
  link: string;
  title: string;
  description: string;
  isAvailable: boolean;
  containsKeywords: boolean;
  matchedKeywords: string[];
}

// Инициализация клиента Redis
const redisClient = createClient({
  url: "redis://127.0.0.1:6379",
});
redisClient.on("error", (err) =>
  logger.log("error", `Redis error: ${err.message}`)
);
await redisClient.connect();

// Названия ключей в Redis
const KEYS = {
  allLinks: "results:allLinks",
  processedLinks: "results:processedLinks",
  unavailableLinks: "results:unavailableLinks",
  keywordMatchedLinks: "results:keywordMatchedLinks",
  nonMatchedLinks: "results:nonMatchedLinks",
  readyForUse: "results:readyForUse",
  processedObjects: "results:processedObjects", // список JSON-строк
  lastUpdated: "results:lastUpdated",
  globalProcessed: "results:globalProcessed", // общий счетчик обработанных ссылок
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

const stemmer = natural.PorterStemmerRu;
const lemmatize = (word: string) => stemmer.stem(word);
const OPTIONS = { threshold: 0.1 };

async function checkKeywords(
  text: string
): Promise<{ contains: boolean; matches: string[] }> {
  if (!text) return { contains: false, matches: [] };

  const normalizedText = normalizeText(text);
  const normalizedKeywords = keywords.flatMap((item) => {
    if (item instanceof Set) {
      return Array.from(item).map((keyword) => normalizeText(keyword));
    } else if (typeof item === "string") {
      return [normalizeText(item)];
    }
    return [];
  });

  let exactMatches: string[] = [];
  for (const keyword of normalizedKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(normalizedText)) {
      exactMatches.push(keyword);
    }
  }
  if (exactMatches.length === 0) {
    const words = normalizedText.match(/\b[\wа-яё'-]+\b/g) || [];
    const stricterOptions = { threshold: 0.3 };
    for (const keyword of normalizedKeywords) {
      if (keyword.includes(" ")) {
        if (normalizedText.includes(keyword)) {
          exactMatches.push(keyword);
        }
      } else {
        const keywordInWords = words.find((word) => word === keyword);
        if (keywordInWords) {
          exactMatches.push(keywordInWords);
        }
      }
    }
    if (exactMatches.length === 0 && words.length > 0) {
      const fuse = new Fuse(normalizedKeywords, stricterOptions);
      for (const word of words) {
        if (word.length > 4) {
          const results = fuse.search(word);
          if (results.length) {
            exactMatches.push(results[0].item);
          }
        }
      }
    }
  }
  const uniqueMatches = Array.from(new Set(exactMatches));
  return { contains: uniqueMatches.length > 0, matches: uniqueMatches };
}

// Финализируем результаты: собираем данные из Redis, сохраняем в JSON и очищаем БД
async function finalizeResults(): Promise<void> {
  try {
    const [
      allLinks,
      processedLinks,
      unavailableLinks,
      keywordMatchedLinks,
      nonMatchedLinks,
      readyForUse,
      processedObjectsRaw,
      lastUpdated,
    ] = await Promise.all([
      redisClient.sMembers(KEYS.allLinks),
      redisClient.sMembers(KEYS.processedLinks),
      redisClient.sMembers(KEYS.unavailableLinks),
      redisClient.sMembers(KEYS.keywordMatchedLinks),
      redisClient.sMembers(KEYS.nonMatchedLinks),
      redisClient.sMembers(KEYS.readyForUse),
      redisClient.lRange(KEYS.processedObjects, 0, -1),
      redisClient.get(KEYS.lastUpdated),
    ]);

    const processedObjects: AdObject[] = processedObjectsRaw.map((item) =>
      JSON.parse(item)
    );
    const results: Results = {
      allLinks,
      processedLinks,
      unavailableLinks,
      keywordMatchedLinks,
      nonMatchedLinks,
      readyForUse,
      processedObjects,
      lastUpdated: lastUpdated || new Date().toISOString(),
    };

    const folder = config.directory;
    const file = config.chunks.filter.outputFile;
    if (!folder || !file) {
      throw new Error(
        "Invalid configuration: directory or outputFile is missing."
      );
    }
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      logger.log("info", `Created directory: ${folder}`);
    }
    const filePath = path.join(folder, file);
    fs.writeFileSync(filePath, JSON.stringify(results, null, 2), "utf-8");
    logger.log("info", `✅ Итоговые результаты сохранены в ${filePath}`);

    await redisClient.del(Object.values(KEYS));
    logger.log("info", "Redis очищен после завершения работы.");
  } catch (error) {
    logger.log(
      "error",
      `Ошибка финализации результатов: ${(error as Error).message}`
    );
  }
}

// Перед запуском очистим всю базу по ключам, чтобы не было старых данных
async function clearRedisBeforeStart(): Promise<void> {
  try {
    await redisClient.del(Object.values(KEYS));
    logger.log("info", "Redis очищен перед запуском парсера.");
  } catch (error) {
    logger.log("error", `Ошибка очистки Redis: ${(error as Error).message}`);
  }
}

export async function readLinksFromFile(): Promise<string[]> {
  const folder = config.directory;
  const filePath = path.join(folder, "links.json");
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const links: unknown = JSON.parse(content);
    if (
      !Array.isArray(links) ||
      !links.every((link) => typeof link === "string")
    ) {
      throw new Error("Файл должен содержать массив строк");
    }
    logger.log("info", `✅ Загружено ${links.length} ссылок из ${filePath}`);
    if (links.length) {
      await redisClient.sAdd(KEYS.allLinks, links);
    }
    return links as string[];
  } catch (error) {
    logger.log(
      "error",
      `Ошибка чтения файла ${filePath}: ${(error as Error).message}`
    );
    return [];
  }
}

export const setupRequestInterception = (page: Page): void => {
  page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    const handle =
      type === "image" || type === "media" || type === "font"
        ? req.abort()
        : req.continue();
    handle.catch((error: Error) => {
      if (!error.message.includes("already handled")) {
        logger.log("debug", `Request handling error: ${error}`);
      }
    });
  });
};

async function processLink(page: Page, link: string): Promise<AdObject> {
  logger.log("info", `🔄 | Обрабатываем: ${link}`);
  try {
    await page.setDefaultTimeout(60000);
    setupRequestInterception(page);
    const response = await page.goto(link, { waitUntil: "domcontentloaded" });
    const status = response?.status();
    if (status && [404, 403, 410].includes(status)) {
      logger.log(
        "info",
        `| 🚫 | Страница недоступна (статус ${status}): ${link}`
      );
      return {
        link,
        title: "",
        description: "",
        isAvailable: false,
        containsKeywords: false,
        matchedKeywords: [],
      };
    }
    await page.waitForSelector("body", { timeout: 60000 });
    const { title, description } = await page.evaluate(() => {
      const getText = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el.textContent?.trim() || "";
        }
        return "";
      };
      return {
        title: getText(["div[data-cy='ad_title'] h4.css-10ofhqw"]),
        description: getText([
          "div[data-cy='ad_description'] > div.css-19duwlz",
        ]),
      };
    });
    if (!title && !description) {
      logger.log("info", `| 📭 | Нет контента: ${link}`);
      return {
        link,
        title: "",
        description: "",
        isAvailable: false,
        containsKeywords: false,
        matchedKeywords: [],
      };
    }
    const fullText = `${title} ${description}`;
    const keywordCheck = await checkKeywords(fullText);
    logger.log(
      "info",
      `🔑 Ключевые слова найдены: ${keywordCheck.contains ? "Да" : "Нет"}`
    );
    return {
      link,
      title,
      description,
      isAvailable: true,
      containsKeywords: keywordCheck.contains,
      matchedKeywords: keywordCheck.matches,
    };
  } catch (error) {
    logger.log(
      "error",
      `❌ Ошибка обработки ${link}: ${(error as Error).message}`
    );
    return {
      link,
      title: "",
      description: "",
      isAvailable: false,
      containsKeywords: false,
      matchedKeywords: [],
    };
  }
}

async function updateResultsInRedis(newObjects: AdObject[]): Promise<void> {
  try {
    for (const obj of newObjects) {
      await redisClient.rPush(KEYS.processedObjects, JSON.stringify(obj));
      if (!obj.isAvailable) {
        await redisClient.sAdd(KEYS.unavailableLinks, obj.link);
      } else {
        await redisClient.sAdd(KEYS.processedLinks, obj.link);
        if (obj.containsKeywords) {
          await redisClient.sAdd(KEYS.keywordMatchedLinks, obj.link);
        } else {
          await redisClient.sAdd(KEYS.nonMatchedLinks, obj.link);
          await redisClient.sAdd(KEYS.readyForUse, obj.link);
        }
      }
    }
    await redisClient.set(KEYS.lastUpdated, new Date().toISOString());
  } catch (error) {
    logger.log(
      "error",
      `Ошибка обновления результатов в Redis: ${(error as Error).message}`
    );
  }
}

/**
 * Функция обработки массива ссылок одним потоком.
 * Для каждого успешно обработанного URL производится атомарное увеличение глобального счетчика.
 */
async function processLinksBatch(
  page: Page,
  links: string[],
  total: number
): Promise<void> {
  for (const link of links) {
    let retries = 3;
    let success = false;
    while (retries > 0 && !success) {
      try {
        const adObject = await processLink(page, link);
        await updateResultsInRedis([adObject]);
        // Атомарное увеличение общего счетчика и получение нового значения
        const globalCount = await redisClient.incr(KEYS.globalProcessed);
        const progress = ((globalCount / total) * 100).toFixed(1);
        const remaining = total - globalCount;
        logger.log(
          "info",
          `📊 | [Поток] Прогресс: ${progress}% | Обработано: ${globalCount}/${total} | Осталось: ${remaining}`
        );
        success = true;
      } catch (error) {
        retries--;
        logger.log(
          "error",
          `⚠ [Поток] Ошибка обработки ${link}. Осталось попыток: ${retries}. Error: ${
            (error as Error).message
          }`
        );
      }
    }
  }
}

export async function Filter(): Promise<void> {
  logger.log("info", "🚀 Запуск обработки...");
  let browser: Browser | null = null;
  try {
    // Перед запуском очищаем Redis, чтобы не было старых данных
    await clearRedisBeforeStart();

    browser = (await launchBrowser({
      headless: config.browser!.headless,
    })) as unknown as Browser;
    const links = await readLinksFromFile();

    // Получаем обработанные ссылки, если они уже есть (на всякий случай)
    const [processed, unavailable] = await Promise.all([
      redisClient.sMembers(KEYS.processedLinks),
      redisClient.sMembers(KEYS.unavailableLinks),
    ]);
    const processedSet = new Set([...processed, ...unavailable]);
    const unprocessedLinks = links.filter((link) => !processedSet.has(link));
    logger.log(
      "info",
      `📋 Осталось обработать: ${unprocessedLinks.length} ссылок`
    );

    // Устанавливаем глобальный счетчик в 0
    await redisClient.set(KEYS.globalProcessed, 0);

    const total = unprocessedLinks.length;
    // Разбиваем на два потока (batch'и)
    const mid = Math.ceil(total / 2);
    const batch1 = unprocessedLinks.slice(0, mid);
    const batch2 = unprocessedLinks.slice(mid);

    // Создаем две страницы для параллельной обработки
    const [page1, page2] = await Promise.all([
      browser.newPage(),
      browser.newPage(),
    ]);

    await Promise.all([
      processLinksBatch(page1, batch1, total),
      processLinksBatch(page2, batch2, total),
    ]);

    await finalizeResults();
  } catch (error) {
    logger.log(
      "error",
      `❌ Критическая ошибка выполнения: ${(error as Error).message}`
    );
  } finally {
    if (browser) {
      await browser.close();
      logger.log("info", "🛑 Браузер закрыт.");
    }
    logger.log("info", "🏁 Обработка завершена!");
    await redisClient.quit();
  }
}
