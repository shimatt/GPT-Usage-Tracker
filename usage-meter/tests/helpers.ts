/** In-memory stand-in for a chrome.storage area (only get/set are used). */
export function fakeArea(): chrome.storage.StorageArea {
  const data: Record<string, unknown> = {};
  return {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    remove: async (key: string) => {
      delete data[key];
    },
  } as unknown as chrome.storage.StorageArea;
}

export const SEC = 1000;
export const MIN = 60 * SEC;
