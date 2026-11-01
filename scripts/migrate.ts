import { getDatabase } from "../src/server/db";
getDatabase().sqlite.close();
console.log("Database migrations applied.");
