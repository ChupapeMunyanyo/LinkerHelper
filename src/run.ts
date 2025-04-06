import { IExecutor } from './Executor';
import ITask from './Task';

export default async function run(executor: IExecutor, queue: AsyncIterable<ITask>, maxThreads = 0) {
    maxThreads = Math.max(0, maxThreads);

    // Map для хранения очередей задач по targetId
    const tasksByTargetId = new Map<number, ITask[]>();
    // Set для отслеживания активных targetId
    const activeTargetIds = new Set<number>();
    // Счётчик активных потоков
    let activeThreads = 0;
    // Флаг завершения итерации очереди
    let queueDone = false;

    // Функция обработки задач для конкретного targetId
    async function processTargetId(targetId: number): Promise<void> {
        const tasks = tasksByTargetId.get(targetId)!;
        while (tasks.length > 0) {
            const task = tasks.shift()!; // Берем первую задачу
            await executor.executeTask(task); // Выполняем её
        }
        // Когда все задачи для targetId выполнены, удаляем его из активных
        activeTargetIds.delete(targetId);
        tasksByTargetId.delete(targetId); // Удаляем пустую очередь
        activeThreads--; // Уменьшаем счётчик потоков
    }

    // Функция запуска обработки для targetId, если есть свободные потоки
    function tryStartTargetId(targetId: number): void {
        if (!activeTargetIds.has(targetId) && (maxThreads === 0 || activeThreads < maxThreads)) {
            const tasks = tasksByTargetId.get(targetId);
            if (tasks && tasks.length > 0) {
                activeTargetIds.add(targetId);
                activeThreads++;
                processTargetId(targetId).catch((error) => {
                    console.error(`Error processing targetId ${targetId}:`, error);
                });
            }
        }
    }

    // Основной цикл обработки очереди
    const iterator = queue[Symbol.asyncIterator]();
    async function processQueue(): Promise<void> {
        while (true) {
            const { done, value: task } = await iterator.next();
            if (done) {
                queueDone = true;
                break;
            }

            const { targetId } = task;

            // Инициализируем очередь для targetId, если её нет
            if (!tasksByTargetId.has(targetId)) {
                tasksByTargetId.set(targetId, []);
            }

            // Добавляем задачу в очередь для targetId
            const targetQueue = tasksByTargetId.get(targetId)!;
            targetQueue.push(task);

            // Пытаемся запустить обработку для этого targetId
            tryStartTargetId(targetId);
        }
    }

    // Запускаем обработку очереди
    const queuePromise = processQueue();

    // Ждём завершения очереди и всех задач
    while (!queueDone || activeThreads > 0 || tasksByTargetId.size > 0) {
        // Проверяем, есть ли незавершённые задачи, которые можно запустить
        for (const targetId of tasksByTargetId.keys()) {
            tryStartTargetId(targetId);
        }
        // Даём возможность другим промисам завершиться
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Ждём завершения обработки очереди
    await queuePromise;
}
