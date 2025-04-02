import launchBrowser from "@/shared/launchBrowser";
import logger from "@/utiles/logger";
import { ChatOllama } from "@langchain/ollama";
import fs from "fs";
import path from "path";
import type { Browser, Page } from "puppeteer";
import config from "../variables";
import { setupRequestInterception, type Results } from "./Filter";

const ollama = new ChatOllama({
  model: "mistral",
});

logger.log("info", "Инициализация AI модели: mistral");

export interface RealEstateData {
  этажность_дома: string | null;
  этаж: string | null;
  тип_строения: string | null;
  ремонт: string | null;
  планировка: string | null;
  количество_комнат: string | null;
  год_постройки: string | null;
  ссылка: string;
  местоположение: string | null;
  дата_публикации: string | null;
  площадь: string | null;
  цена: string;
  цена_за_м2: string | null;
  цена_сум: string | null;
  цена_за_м2_сум: string | null;
}

async function appendToJsonFile(data: RealEstateData): Promise<void> {
  const processedFileName: string = config.chunks.ai.processedFileName;
  const filePath: string = path.join(config.directory, processedFileName);

  logger.log("debug", `Подготовка к записи данных в файл: ${filePath}`);
  logger.log("debug", `Данные для записи: ${JSON.stringify(data, null, 2)}`);

  try {
    if (!fs.existsSync(config.directory)) {
      logger.log("info", `Создание директории: ${config.directory}`);
      await fs.promises.mkdir(config.directory, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      logger.log("info", `Создание нового файла: ${filePath}`);
      await fs.promises.writeFile(
        filePath,
        JSON.stringify([], null, 2),
        "utf-8"
      );
    }

    const fileContent: string = await fs.promises.readFile(filePath, "utf-8");
    let jsonData: RealEstateData[] = [];

    if (fileContent) {
      try {
        jsonData = JSON.parse(fileContent);
        logger.log(
          "debug",
          `Текущее количество записей в файле: ${jsonData.length}`
        );
      } catch {
        logger.log(
          "warning",
          `Файл ${filePath} содержит некорректный JSON, создаем новый массив`
        );
      }
    }

    jsonData.push(data);
    logger.log("info", `Запись ${jsonData.length} записей в файл ${filePath}`);
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(jsonData, null, 2),
      "utf-8"
    );
    logger.log("success", `Данные успешно записаны в файл: ${filePath}`);
  } catch (error) {
    logger.log("error", `Ошибка при работе с файлом: ${error}`);
  }
}

async function extractDataFromPage(
  link: string,
  browser: Browser
): Promise<{
  title: string;
  description: string;
  parameters: string[];
  price: string;
  location: string;
} | null> {
  logger.log("info", `Начало извлечения данных со страницы: ${link}`);
  let page: Page | null = null;

  try {
    page = await browser.newPage();
    logger.log("debug", "Установка User-Agent и заголовков");
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      Referer: "https://www.olx.uz/",
    });
  } catch (error) {
    logger.log("error", `Не удалось открыть новую вкладку: ${error}`);
    return null;
  }

  try {
    logger.log("debug", "Настройка перехвата запросов");
    setupRequestInterception(page);

    logger.log("info", "Переход на страницу объявления");
    await page.goto(link, { waitUntil: "networkidle2", timeout: 90000 });

    const adNotAvailable = await page.$('div[data-testid="ad-inactive-msg"]');
    if (adNotAvailable) {
      logger.log("warning", `Объявление неактивно: ${link}`);
      await appendToLeakedFile(link);
      return null;
    }

    logger.log("debug", "Ожидание необходимых элементов");
    await Promise.all([
      page.waitForSelector("div[data-cy='ad_title'] > h4.css-10ofhqw", {
        timeout: 10000,
      }),
      page.waitForSelector("div[data-cy='ad_description'] > div.css-19duwlz", {
        timeout: 10000,
      }),
    ]);

    logger.log("info", "Извлечение данных со страницы");
    const result = await page.evaluate(() => {
      const getText = (selector: string): string | null => {
        const el = document.querySelector(selector);
        return el?.textContent?.trim() || null;
      };

      const title = getText("div[data-cy='ad_title'] > h4");
      const description = getText(
        "div[data-cy='ad_description'] > div.css-19duwlz"
      );

      const parameterNodes = document.querySelectorAll(
        "div.css-41yf00 > div.css-ae1s7g > div.css-1msmb8o > p.css-z0m36u"
      );
      const parameters = Array.from(parameterNodes)
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean);
      const price = getText(
        "div[data-testid='ad-price-container'] > h3.css-fqcbii"
      );

      const location = getText(
        "section.css-wefbef div.css-13l8eec div p.css-7wnksb"
      );

      return {
        title,
        description,
        parameters,
        price,
        location,
      };
    });

    logger.log(
      "debug",
      `Извлеченные данные: ${JSON.stringify(result, null, 2)}`
    );

    if (
      !result.title ||
      !result.description ||
      result.parameters.length === 0
    ) {
      logger.log("warning", "Не удалось извлечь все необходимые данные");
      return null;
    }
    if (
      !result.title ||
      !result.description ||
      !result.price ||
      !result.location
    ) {
      logger.log("warning", "Некоторые поля содержат null значения");
      return null;
    }

    logger.log("success", "Данные успешно извлечены");
    return {
      title: result.title,
      description: result.description,
      parameters: result.parameters,
      price: result.price,
      location: result.location,
    };
  } catch (error) {
    logger.log(
      "error",
      `Ошибка при извлечении данных со страницы ${link}: ${error}`
    );
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
        logger.log("debug", "Страница закрыта");
      } catch (closeError) {
        logger.log("error", `Ошибка при закрытии страницы: ${closeError}`);
      }
    }
  }
}

async function appendToLeakedFile(link: string): Promise<void> {
  const leakedFileName: string = config.chunks.ai.leakedFileName;
  const folder: string = config.directory;
  const filePath: string = path.join(folder, leakedFileName);

  logger.log("info", `Добавление ссылки в файл утечек: ${link}`);

  try {
    try {
      await fs.promises.access(filePath);
      logger.log("debug", "Файл утечек существует");
    } catch {
      logger.log("info", "Создание нового файла утечек");
      await fs.promises.writeFile(
        filePath,
        JSON.stringify([], null, 2),
        "utf-8"
      );
    }

    const fileContent: string = await fs.promises.readFile(filePath, "utf-8");
    if (!fileContent) {
      logger.log("error", `Файл ${filePath} пустой`);
      return;
    }
    const leakedLinks: string[] = JSON.parse(fileContent);
    logger.log(
      "debug",
      `Текущее количество ссылок в файле утечек: ${leakedLinks.length}`
    );

    if (!leakedLinks.includes(link)) {
      leakedLinks.push(link);
      logger.log("info", "Ссылка добавлена в файл утечек");
    } else {
      logger.log("debug", "Ссылка уже существует в файле утечек");
    }

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(leakedLinks, null, 2),
      "utf-8"
    );
    logger.log("success", "Файл утечек успешно обновлен");
  } catch (error) {
    logger.log("error", `Ошибка при обновлении файла утечек: ${error}`);
  }
}

async function readFileContent(
  folder: string,
  fileName: string
): Promise<Results> {
  const filePath: string = path.join(folder, fileName);
  logger.log("info", `Чтение файла: ${filePath}`);

  try {
    await fs.promises.access(filePath);
    logger.log("debug", "Файл существует");
  } catch {
    logger.log("error", `Файл ${filePath} не существует`);
    return {} as Results;
  }

  try {
    const fileContent: string = await fs.promises.readFile(filePath, "utf-8");
    if (!fileContent) {
      logger.log("error", `Файл ${filePath} пустой`);
      return {} as Results;
    }
    const results = JSON.parse(fileContent) as Results;
    logger.log(
      "debug",
      `Успешно прочитано ${Object.keys(results).length} результатов`
    );
    return results;
  } catch (error) {
    logger.log("error", `Ошибка при чтении файла ${filePath}: ${error}`);
    return {} as Results;
  }
}

function fixMalformedJson(jsonStr: string): string {
  jsonStr = jsonStr.trim();
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return jsonStr.substring(firstBrace, lastBrace + 1);
  }
  return jsonStr;
}
export function messageTemplate(text: string, link: string): string {
  logger.log("debug", "Создание шаблона сообщения для AI");
  return `
Ты - помощник, который анализирует объявления о недвижимости и извлекает из них конкретные данные.
Тебе предоставляется текст объявления, и ты должен вернуть JSON-объект с заполненными полями.
Если ты не можешь определить какое-то значение, ставь null.
Если объявление не о продаже, а об аренде (например, содержит слова "сдается", "в аренду" и т.п.), верни только строку "ERROR", без дополнительного текста.

Поля:
- "этажность_дома": string | null
- "этаж": string | null
- "тип_строения": string | null
- "ремонт": string | null
- "планировка": string | null
- "количество_комнат": string | null
- "год_постройки": string | null
- "ссылка": string (уже заполнена)
- "местоположение": string | null
- "площадь": number | null

Текст объявления:
${text}

Ссылка: ${link}

Верни только JSON-объект или строку "ERROR", без дополнительного текста. Прежде чем отправить JSON обьект проверь его на валидность. Приведи полученные данные в нужный вид!
`.trim();
}

async function appendToDebugFile(data: {
  prompt: string;
  rawResponse: string;
  finalResponse: RealEstateData | "ERROR";
  inputText: string;
}): Promise<void> {
  const debugFileName: string =
    config.chunks.ai.debugFileName || "debug_processed_data.json";
  const filePath: string = path.join(config.directory, debugFileName);

  logger.log(
    "debug",
    `Подготовка к записи отладочных данных в файл: ${filePath}`
  );

  try {
    if (!fs.existsSync(config.directory)) {
      logger.log("info", `Создание директории: ${config.directory}`);
      await fs.promises.mkdir(config.directory, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      logger.log(
        "info",
        `Создание нового файла отладочных данных: ${filePath}`
      );
      await fs.promises.writeFile(
        filePath,
        JSON.stringify([], null, 2),
        "utf-8"
      );
    }

    const fileContent: string = await fs.promises.readFile(filePath, "utf-8");
    let debugData: any[] = [];

    if (fileContent) {
      try {
        debugData = JSON.parse(fileContent);
        logger.log(
          "debug",
          `Текущее количество отладочных записей в файле: ${debugData.length}`
        );
      } catch {
        logger.log(
          "warning",
          `Файл ${filePath} содержит некорректный JSON, создаем новый массив`
        );
      }
    }

    debugData.push({
      timestamp: new Date().toISOString(),
      ...data,
    });

    await fs.promises.writeFile(
      filePath,
      JSON.stringify(debugData, null, 2),
      "utf-8"
    );
    logger.log(
      "success",
      `Отладочные данные успешно записаны в файл: ${filePath}`
    );
  } catch (error) {
    logger.log("error", `Ошибка при записи отладочных данных: ${error}`);
  }
}

export async function processWithAI(
  ollama: ChatOllama,
  text: string,
  link: string,
  priceUSD: string
): Promise<RealEstateData | "ERROR"> {
  const exchangeRate: number = 12900;
  logger.log("info", `Обработка объявления AI: ${link}`);
  logger.log("debug", `Курс конвертации: ${exchangeRate} сум/долл`);
  logger.log("debug", `Цена в USD: ${priceUSD}`);
  const message: string = messageTemplate(text, link);
  logger.log("debug", "Отправка запроса к AI модели");

  const response = await ollama.invoke([["human", message]]);
  let result: string = (response.content as string).trim();
  logger.log("debug", `Первичный ответ от AI: ${result}`);

  if (result === "ERROR") {
    logger.log("warning", "AI определил объявление как аренду");
    await appendToDebugFile({
      prompt: message,
      rawResponse: result,
      finalResponse: "ERROR",
      inputText: text,
    });
    return "ERROR";
  }

  let parsedResult: RealEstateData;
  try {
    parsedResult = JSON.parse(result) as RealEstateData;
  } catch (error) {
    logger.log(
      "warning",
      `Первичный JSON невалиден: ${error}. Пытаемся исправить...`
    );
    // Пробуем исправить строку
    const fixedResult = fixMalformedJson(result);
    logger.log("debug", `Исправленная строка: ${fixedResult}`);
    try {
      parsedResult = JSON.parse(fixedResult) as RealEstateData;
    } catch (error) {
      logger.log("error", `Не удалось исправить JSON: ${error}`);
      parsedResult = {
        этажность_дома: null,
        этаж: null,
        тип_строения: null,
        ремонт: null,
        планировка: null,
        количество_комнат: null,
        год_постройки: null,
        ссылка: link,
        цена: priceUSD,
        местоположение: null,
        дата_публикации: null,
        площадь: null,
        цена_за_м2: null,
        цена_сум: null,
        цена_за_м2_сум: null,
      };
    }
  }

  // Устанавливаем обязательные поля
  parsedResult.ссылка = link;
  parsedResult.цена = priceUSD;

  const numericPrice: number = parseFloat(priceUSD);
  const numericArea: number = parsedResult.площадь
    ? parseFloat(parsedResult.площадь)
    : NaN;

  logger.log(
    "debug",
    `Числовая цена: ${numericPrice}, Площадь: ${numericArea}`
  );

  if (!isNaN(numericPrice) && !isNaN(numericArea) && numericArea > 0) {
    parsedResult.цена_за_м2 = (numericPrice / numericArea).toFixed(2);
    parsedResult.цена_сум = (numericPrice * exchangeRate).toFixed(0);
    parsedResult.цена_за_м2_сум = (
      (numericPrice * exchangeRate) /
      numericArea
    ).toFixed(2);
    logger.log(
      "debug",
      `Рассчитанные цены:
      - Цена за м²: ${parsedResult.цена_за_м2} USD
      - Цена в сумах: ${parsedResult.цена_сум} сум
      - Цена за м² в сумах: ${parsedResult.цена_за_м2_сум} сум/м²`
    );
  } else {
    logger.log(
      "warning",
      "Невозможно рассчитать цены из-за некорректных данных"
    );
    parsedResult.цена_за_м2 = null;
    parsedResult.цена_сум = null;
    parsedResult.цена_за_м2_сум = null;
  }

  await appendToDebugFile({
    prompt: message,
    rawResponse: result,
    finalResponse: parsedResult,
    inputText: text,
  });

  logger.log("success", "Данные успешно обработаны AI");
  return parsedResult;
}

export async function AiTable(): Promise<void> {
  logger.log("info", "Начало обработки объявлений");

  const results: Results = await readFileContent(
    config.directory,
    config.chunks.filter.outputFile
  );

  if (!results) {
    logger.log("error", "Нет результатов для обработки");
    return;
  }

  const nonMatchedLinks: string[] = results.readyForUse;
  logger.log("info", `Найдено ${nonMatchedLinks.length} ссылок для обработки`);
  let browser: Browser | null = null;

  try {
    logger.log("info", "Запуск браузера");
    browser = (await launchBrowser({
      headless: config.browser!.headless,
    })) as Browser;
    logger.log("success", "Браузер успешно запущен");
  } catch (error) {
    logger.log("error", `Ошибка при запуске браузера: ${error}`);
    return;
  }

  try {
    for (const link of nonMatchedLinks) {
      logger.log("info", `Обработка ссылки: ${link}`);
      try {
        const data = await extractDataFromPage(link, browser);
        if (!data) {
          logger.log(
            "error",
            `Не удалось извлечь данные для ${link}. Добавляем в leaked.`
          );
          await appendToLeakedFile(link);
          continue;
        }

        const { title, description, parameters, price, location } = data;
        const text: string = `Название: ${title}\nОписание: ${description}\nПараметры: ${parameters.join(
          ", "
        )}\nМестоположение: ${location}}`;

        logger.log("debug", "Подготовка данных для AI");
        const aiResult = await processWithAI(ollama, text, link, price!);

        if (aiResult === "ERROR") {
          logger.log("warning", `Объявление об аренде: ${link}`);
          await appendToLeakedFile(link);
          continue;
        }

        await appendToJsonFile(aiResult);
        logger.log("success", `Успешно обработана ссылка: ${link}`);
      } catch (error) {
        logger.log("error", `Ошибка при обработке ${link}: ${error}`);
        await appendToLeakedFile(link);
      }
    }
  } finally {
    if (browser) {
      logger.log("info", "Закрытие браузера");
      await browser.close();
      logger.log("success", "Браузер успешно закрыт");
    }
    logger.log("success", "Обработка всех объявлений завершена!");
  }
}
