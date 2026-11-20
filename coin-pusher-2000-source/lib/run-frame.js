export default function runFrame(update, scheduleNextFrame, onError) {
    try {
        update();
    } catch (error) {
        if (!onError) throw error;
        onError(error);
    } finally {
        scheduleNextFrame();
    }
}
