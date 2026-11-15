const DATABASE_NAME = "coin-pusher-2000-setup";
const VIDEO_STORE_NAME = "videos";

function openDatabase() {
    if (!globalThis.indexedDB) {
        return Promise.reject(new Error("Le stockage persistant des vidéos n’est pas pris en charge."));
    }
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(VIDEO_STORE_NAME)) {
                database.createObjectStore(VIDEO_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Impossible d’ouvrir le stockage des vidéos."));
    });
}

async function runTransaction(mode, operation) {
    const database = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(VIDEO_STORE_NAME, mode);
            const request = operation(transaction.objectStore(VIDEO_STORE_NAME));
            transaction.oncomplete = () => resolve(request?.result ?? null);
            transaction.onerror = () => reject(transaction.error || request?.error || new Error("Échec du stockage de la vidéo."));
            transaction.onabort = () => reject(transaction.error || new Error("Le stockage de la vidéo a été annulé."));
        });
    } finally {
        database.close();
    }
}

export function saveSetupVideo(key, file) {
    return runTransaction("readwrite", store => store.put(file, key));
}

export function loadSetupVideo(key) {
    return runTransaction("readonly", store => store.get(key));
}

export function deleteSetupVideo(key) {
    return runTransaction("readwrite", store => store.delete(key));
}
