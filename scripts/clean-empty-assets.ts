import { pruneEmptyAssetDirectories } from "../src/server/storage/assets";
import { getDatabase } from "../src/server/db";
try {
  const removed=pruneEmptyAssetDirectories();
  console.log(`Removed ${removed} empty asset director${removed===1?"y":"ies"}. Nonempty folders and the assets root were preserved.`);
} finally { getDatabase().sqlite.close(); }
