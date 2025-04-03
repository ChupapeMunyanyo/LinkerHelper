import { IExecutor } from './Executor';
import ITask from './Task';

export default async function run(executor: IExecutor, queue: AsyncIterable<ITask>, maxThreads = 0) {
    maxThreads = Math.max(0, maxThreads);
    
    const runningTasks = new Set<Promise<void>>();
    const taskQueue: AsyncIterator<ITask> = queue[Symbol.asyncIterator]();

    async function processQueue() {
        while (true) {
            // Ожидаем освобождения места для новых задач, если есть ограничение
            if (maxThreads > 0 && runningTasks.size >= maxThreads) {
                await Promise.race(runningTasks);
                continue;
            }

            const next = await taskQueue.next();
            if (next.done) break;

            const task = next.value;
            const taskPromise = executor.executeTask(task)
                .finally(() => runningTasks.delete(taskPromise));

            runningTasks.add(taskPromise);
        }
    }

    // Дожидаемся завершения всех запущенных задач
    await processQueue();
    await Promise.all(runningTasks);
}