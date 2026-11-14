async function getCachedAvatar(cache, key, load, retries = 0) {
    let request = cache.get(key);
    if (!request) {
        request = Promise.resolve().then(async () => {
            let lastError;
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    const avatar = await load();
                    if (!avatar) {
                        throw new Error("Réponse image invalide.");
                    }
                    return avatar;
                } catch (error) {
                    lastError = error;
                    if (attempt < retries) {
                        await new Promise(resolve => setTimeout(resolve, 150));
                    }
                }
            }
            throw lastError;
        });
        cache.set(key, request);
    }

    try {
        return await request;
    } catch (error) {
        if (cache.get(key) === request) {
            cache.delete(key);
        }
        throw error;
    }
}

module.exports = getCachedAvatar;
