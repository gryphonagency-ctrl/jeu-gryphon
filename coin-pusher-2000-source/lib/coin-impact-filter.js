const MIN_FALLING_SPEED = 0.05;

export function shouldPlayCoinImpact(first, second, coinType, getCoin) {
    if (first?.objectType !== coinType || second?.objectType !== coinType) {
        return false;
    }
    return [first.index, second.index].some(index => {
        const coin = getCoin(index);
        return coin?.used === true && coin.body.linvel().y < -MIN_FALLING_SPEED;
    });
}
