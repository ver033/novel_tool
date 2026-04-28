import { contextBridge } from "electron";
import { novelToolApi } from "./api";

contextBridge.exposeInMainWorld("api", novelToolApi);
contextBridge.exposeInMainWorld("novelTool", novelToolApi);
