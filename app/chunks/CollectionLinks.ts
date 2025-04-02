import launchBrowser from "@/shared/launchBrowser";
import fs from "fs/promises";
import path from "path";
import { Browser, Page } from "puppeteer";
import logger from "../utiles/logger";
import config from "../variables";

const BASE_URL = config.url;

async function navigateToNextPage(
  page: Page,
  pageNumber: number
): Promise<boolean> {
  logger.log("debug", `Navigating to page ${pageNumber + 1}...`);
  const MAX_RETRIES = 25;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = new URL(BASE_URL);
      const params = new URLSearchParams(url.search);
      params.set("page", String(pageNumber + 1));
      url.search = params.toString();
      const nextPageUrl = url.toString();

      logger.log("debug", `Attempt ${attempt}: navigating to ${nextPageUrl}`);
      await page.goto(nextPageUrl, {
        waitUntil: "domcontentloaded",
      });

      logger.log("debug", `After navigation: ${await page.url()}`);

      return true;
    } catch (error: any) {
      logger.log("error", `Attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        logger.log("debug", `Retrying navigation in 5 seconds...`);
      }
    }
  }

  console.error(
    `Failed to navigate to page ${
      pageNumber + 1
    } after ${MAX_RETRIES} attempts.`
  );
  return false;
}

async function saveToJSON(links: string[]) {
  try {
    const folder = path.resolve(process.cwd(), config.directory);
    await fs.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, "links.json");
    let existingLinks: string[] = [];
    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      existingLinks = JSON.parse(fileContent) as string[];
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "ENOENT") {
        logger.log("error", `Error reading existing file: ${error}`);
        return;
      }
    }
    logger.log("debug", `Existing links: ${existingLinks.length}`);
    logger.log("debug", `New links before filtering: ${links.length}`);
    const uniqueNewLinks = links.filter(
      (link) => !existingLinks.includes(link)
    );
    if (uniqueNewLinks.length === 0) {
      logger.log("info", "No new links to save.");
      return;
    }
    const combinedLinks = [...existingLinks, ...uniqueNewLinks];
    await fs.writeFile(
      filePath,
      JSON.stringify(combinedLinks, null, 2),
      "utf-8"
    );
    // logger.log(
    //   "success",
    //   // `✅ Saved to ${filePath} (Total links: ${combinedLinks.length}, New links: ${uniqueNewLinks.length})`
    // );
  } catch (error) {
    logger.log("error", `❌ Error saving JSON: ${error}`);
  }
}

async function getMaxPages(page: Page): Promise<number> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const maxPages = await page.evaluate(() => {
    const paginationLinks = document.querySelectorAll(
      '[data-testid^="pagination-link-"]'
    );
    let maxPage = 1;
    paginationLinks.forEach((link) => {
      const pageNum = parseInt(link.textContent || "0", 10);
      if (!isNaN(pageNum) && pageNum > maxPage) maxPage = pageNum;
    });
    return maxPage;
  });
  logger.log("debug", `Found ${maxPages} pages.`);
  return maxPages;
}
async function parseListingsOnPage(page: Page): Promise<{ link: string }[]> {
  logger.log("debug", "Extracting listing links from page...");
  try {
    const hasCards = await page.evaluate(() => {
      return document.querySelectorAll('[data-cy="l-card"]').length > 0;
    });

    if (!hasCards) {
      logger.log(
        "warning",
        "No listing cards found on the page. Waiting and retrying..."
      );
      const hasCardsAfterWait = await page.evaluate(() => {
        return document.querySelectorAll('[data-cy="l-card"]').length > 0;
      });
      if (!hasCardsAfterWait) {
        logger.log(
          "error",
          "Still no listing cards found after waiting. Page content may have changed."
        );
        return [];
      }
    }

    const listings = await page.evaluate(() => {
      const results: { link: string }[] = [];
      const cards = document.querySelectorAll('[data-cy="l-card"]');
      cards.forEach((card) => {
        try {
          const linkElement = card.querySelector("a");
          const link = linkElement?.href || "";
          if (link) {
            results.push({ link });
          }
        } catch (error) {
          console.error("Error parsing card:", error);
        }
      });
      return results;
    });

    if (listings.length === 0) {
      logger.log("warning", "No links were extracted from the cards");
    } else {
      logger.log("debug", `Successfully extracted ${listings.length} links`);
    }

    return listings;
  } catch (error) {
    logger.log("error", `Error parsing listings: ${error}`);
    return [];
  }
}

export async function CollectionLinks() {
  logger.log("debug", "Starting parsing");

  let browser: Browser;
  let page: Page;
  const allListings: { link: string }[] = [];
  let savedCount = 0;

  try {
    browser = await launchBrowser({ headless: config.browser?.headless }); // `Browser` тип уже известен
    page = await browser.newPage(); // `Page` тип уже известен

    await page.setRequestInterception(true);
    page.on("request", async (req) => {
      try {
        if (req.resourceType() === "image") {
          await req.abort();
        } else {
          await req.continue();
        }
      } catch (error) {
        logger.log("debug", `Request handling error: ${error}`);
      }
    });

    const response = await page.goto(BASE_URL!, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const status = response?.status();

    if (status && [404, 403, 410].includes(status)) {
      console.log(`🚫 Страница недоступна (статус ${status}): ${BASE_URL}`);
    }

    let pageNumber = 1;
    const maxPages = await getMaxPages(page);

    while (pageNumber <= maxPages && pageNumber <= 25) {
      logger.log("info", `Parsing page ${pageNumber} of ${maxPages}`);
      const contentLoaded = await page.evaluate(() => {
        return document.querySelectorAll('[data-cy="l-card"]').length > 0;
      });

      if (!contentLoaded) {
        logger.log(
          "warning",
          "Content not loaded properly. Refreshing the page..."
        );
        await page.reload({ waitUntil: "domcontentloaded" });
      }

      const pageListings = await parseListingsOnPage(page);

      if (pageListings.length === 0) {
        logger.log(
          "warning",
          "No listings found on this page. This might indicate a problem."
        );
        const isBlocked = await page.evaluate(() => {
          return (
            document.body.textContent?.includes("captcha") ||
            document.body.textContent?.includes("blocked") ||
            document.body.textContent?.includes("suspicious activity")
          );
        });

        if (isBlocked) {
          logger.log("error", "Possible CAPTCHA or IP block detected!");
          break;
        }

        const retryPageListings = await parseListingsOnPage(page);
        if (retryPageListings.length === 0) {
          logger.log(
            "error",
            "Still no listings after retry. Moving to next page."
          );
        } else {
          logger.log(
            "debug",
            `Found ${retryPageListings.length} listings after retry`
          );
          const listingsWithTimestamp = retryPageListings.map((listing) => ({
            ...listing,
          }));
          allListings.push(...listingsWithTimestamp);
        }
      } else {
        const listingsWithTimestamp = pageListings.map((listing) => ({
          ...listing,
        }));
        logger.log(
          "info",
          `Found ${listingsWithTimestamp.length} listings on page ${pageNumber}`
        );
        allListings.push(...listingsWithTimestamp);
      }

      if (allListings.length - savedCount >= 3) {
        const links = allListings.map((item) => item.link);
        await saveToJSON(links);
        savedCount = allListings.length;
        console.log(`Intermediate save: ${allListings.length} listings total`);
      }

      if (pageNumber < 25) {
        const navigationSuccess = await navigateToNextPage(page, pageNumber);
        if (navigationSuccess) {
          pageNumber++;
        } else {
          logger.log(
            "error",
            "Navigation to next page failed, ending scraping."
          );
          break;
        }
      } else {
        logger.log("debug", "Reached max pages limit");
        break;
      }
    }
    if (allListings.length > savedCount) {
      const links = allListings.map((item) => item.link);
      await saveToJSON(links);
    }

    await logger.log(
      "debug",
      `Total listings collected: ${allListings.length}`
    );
    await logger.log("success", "Scraping completed");
  } catch (error) {
    logger.log("error", `Critical error: ${error}`);
    if (allListings.length > 0) {
      logger.log(
        "debug",
        `Saving ${allListings.length} listings despite error...`
      );
      const links = allListings.map((item) => item.link);
      await saveToJSON(links);
      logger.log("debug", "Filtering...");
    }
  } finally {
    if (page!) {
      await page.close().catch((e) => console.warn("Error closing page:", e));
    }
    if (browser!) {
      await browser
        .close()
        .catch((e) => console.warn("Error closing browser:", e));
      logger.log("success", "Browser closed");
    }
  }
}
