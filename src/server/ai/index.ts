import "server-only";
import { config } from "../config";
import { FakeProvider } from "./fake";
import { MuseProvider } from "./muse";
export const provider = config.fakeAI ? new FakeProvider() : new MuseProvider();
