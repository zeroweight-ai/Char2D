import { afterEach,beforeEach,expect,it,vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolve } from "node:path";
vi.mock("../src/server/config",()=>({config:{fakeAI:true}}));
import { openDatabase } from "../src/server/db";
import { migrate } from "../src/server/db/migrate";
import * as schema from "../src/server/db/schema";
import { getCharacter } from "../src/server/characters/repository";
import { GET } from "../src/app/api/characters/route";

const globalDb=globalThis as typeof globalThis & {char2dDb?:ReturnType<typeof openDatabase>};
let previous:ReturnType<typeof openDatabase>|undefined;
let sqlite:Database.Database;
beforeEach(()=>{
  previous=globalDb.char2dDb;
  sqlite=new Database(":memory:");
  // Build the database as it existed before the side-view-only upgrade.
  sqlite.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)");
  for(const migration of readMigrationFiles({migrationsFolder:resolve("drizzle")})){
    if(migration.folderMillis>1793699459677)break;
    for(const statement of migration.sql)sqlite.exec(statement);
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(migration.hash,migration.folderMillis);
  }
  globalDb.char2dDb={sqlite,db:drizzle(sqlite,{schema})};
});
afterEach(()=>{globalDb.char2dDb=previous;sqlite.close();});

it("migrates legacy views so list and detail reads work without changing animation data",async()=>{
  const manifest=(viewType:string)=>({version:1,characterId:viewType,viewType,atlas:{url:"/api/assets/atlas",width:8,height:8,version:2},pixelScale:1,actions:{idle:{label:"Idle",playback:"loop",directions:{right:{frames:[{x:0,y:0,w:8,h:8,anchorX:4,anchorY:8,durationMs:100}]},left:{mirrorOf:"right"}},gameplay:{trigger:"hold",lockMovement:false,interruptible:true}}}});
  const insert=sqlite.prepare("INSERT INTO characters (id,name,view_type,manifest_json,status,atlas_asset_id,atlas_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  for(const view of ["top_down","three_quarter","side_scroller"]){
    insert.run(view,view,view,JSON.stringify(manifest(view)),"ready","atlas",2,1,1);
  }
  insert.run("draft","Draft","top_down",null,"draft",null,0,1,1);
  const sideBefore=sqlite.prepare("SELECT * FROM characters WHERE id='side_scroller'").get();
  const legacyBefore=sqlite.prepare("SELECT * FROM characters WHERE id='top_down'").get();

  migrate(sqlite);
  for(const view of ["top_down","three_quarter","side_scroller"]){
    expect(getCharacter(view)?.manifest).toEqual({...manifest(view),viewType:"side_scroller"});
  }
  expect(sqlite.prepare("SELECT * FROM characters WHERE id='side_scroller'").get()).toEqual(sideBefore);
  expect(sqlite.prepare("SELECT * FROM characters WHERE id='top_down'").get()).toEqual({...legacyBefore as object,view_type:"side_scroller",manifest_json:JSON.stringify({...manifest("top_down"),viewType:"side_scroller"})});
  expect(sqlite.prepare("SELECT view_type,manifest_json FROM characters WHERE id='draft'").get()).toEqual({view_type:"side_scroller",manifest_json:null});
  const response=await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveLength(4);

  const rows=sqlite.prepare("SELECT * FROM characters ORDER BY id").all();
  const journal=sqlite.prepare("SELECT * FROM __drizzle_migrations").all();
  migrate(sqlite);
  expect(sqlite.prepare("SELECT * FROM characters ORDER BY id").all()).toEqual(rows);
  expect(sqlite.prepare("SELECT * FROM __drizzle_migrations").all()).toEqual(journal);
});
