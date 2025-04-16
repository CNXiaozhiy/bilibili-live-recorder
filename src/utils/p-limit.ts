class Node<T> {
    value: T;
    next: Node<T> | null;

    constructor(value: T) {
        this.value = value;
        this.next = null;
    }
}

class Queue<T> {
    private head: Node<T> | null;
    private tail: Node<T> | null;
    private size: number;

    constructor() {
        this.head = null;
        this.tail = null;
        this.size = 0;
    }

    enqueue(value: T): void {
        const node = new Node(value);

        if (this.head) {
            this.tail!.next = node;
            this.tail = node;
        } else {
            this.head = node;
            this.tail = node;
        }

        this.size++;
    }

    dequeue(): T | undefined {
        if (!this.head) {
            return undefined;
        }

        const value = this.head.value;
        this.head = this.head.next;
        this.size--;

        if (!this.head) {
            this.tail = null;
        }

        return value;
    }

    clear(): void {
        this.head = null;
        this.tail = null;
        this.size = 0;
    }

    getSize(): number {
        return this.size;
    }
}

function validateConcurrency(concurrency: number): void {
    if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
        throw new TypeError('Expected `concurrency` to be a number from 1 and up');
    }
}

export default function pLimit(concurrency: number) {
    validateConcurrency(concurrency);

    const queue = new Queue<() => void>();
    let activeCount = 0;

    const resumeNext = () => {
        if (activeCount < concurrency && queue.getSize() > 0) {
            const nextTask = queue.dequeue();
            if (nextTask) {
                nextTask();
                activeCount++;
            }
        }
    };

    const next = () => {
        activeCount--;
        resumeNext();
    };

    const run = async (fn: Function, resolve: Function, args: any[]) => {
        const result = (async () => fn(...args))();
        resolve(result);

        try {
            await result;
        } catch (error) {
            // Handle error if needed
        }

        next();
    };

    const enqueue = (fn: Function, resolve: Function, args: any[]) => {
        queue.enqueue(() => run(fn, resolve, args));

        (async () => {
            await Promise.resolve();

            if (activeCount < concurrency) {
                resumeNext();
            }
        })();
    };

    const generator = (fn: Function, ...args: any[]) => new Promise(resolve => {
        enqueue(fn, resolve, args);
    });

    Object.defineProperties(generator, {
        activeCount: {
            get: () => activeCount,
        },
        pendingCount: {
            get: () => queue.getSize(),
        },
        clearQueue: {
            value: () => {
                queue.clear();
            },
        },
        concurrency: {
            get: () => concurrency,
            set: (newConcurrency: number) => {
                validateConcurrency(newConcurrency);
                concurrency = newConcurrency;

                queueMicrotask(() => {
                    while (activeCount < concurrency && queue.getSize() > 0) {
                        resumeNext();
                    }
                });
            },
        },
    });

    return generator;
}