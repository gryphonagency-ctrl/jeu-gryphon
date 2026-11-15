export default function runFrame(update, scheduleNextFrame) {
    try {
        update();
    } finally {
        scheduleNextFrame();
    }
}
