import { AiTable } from "./chunks/AiTable";

// import { CollectionLinks } from "./chunks/CollectionLinks";

import logger from "./utiles/logger";

async function main() {
  // try {
  //   await CollectionLinks();
  // } catch (error) {
  //   logger.log("error", `Critical error: ${error}`);
  // }

  // try {
  //   await Filter();
  // } catch (error) {
  //   logger.log("error", `Critical error: ${error}`);
  // }

  try {
    await AiTable();
  } catch (error) {
    logger.log("error", `Critical error: ${error}`);
  }
}

main();
