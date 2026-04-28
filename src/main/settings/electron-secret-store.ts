import { safeStorage } from "electron";
import type { SecretStore } from "./settings-service";

export function createElectronSecretStore(): SecretStore {
  return {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Electron safeStorage 不可用，不能保存 OpenRouter API Key。");
      }
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Electron safeStorage 不可用，不能读取 OpenRouter API Key。");
      }
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    }
  };
}
