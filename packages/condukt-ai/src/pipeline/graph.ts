import type { TaskDefinition } from "./types.js";

export function buildDependencyLevels(tasks: readonly TaskDefinition[]): string[][] {
  const byId = new Map<string, TaskDefinition>();
  const order = new Map<string, number>();

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (byId.has(task.id)) {
      throw new Error(`duplicate task id '${task.id}'`);
    }
    byId.set(task.id, task);
    order.set(task.id, index);
  }

  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const task of tasks) {
    outgoing.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const task of tasks) {
    for (const dependency of task.after ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(`task '${task.id}' depends on unknown task '${dependency}'`);
      }

      outgoing.get(dependency)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  for (const children of outgoing.values()) {
    children.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  }

  let ready = tasks.filter((task) => (inDegree.get(task.id) ?? 0) === 0).map((task) => task.id);

  const levels: string[][] = [];
  let seenCount = 0;

  while (ready.length > 0) {
    const current = ready;
    levels.push(current);
    seenCount += current.length;

    const next: string[] = [];
    for (const taskId of current) {
      const children = outgoing.get(taskId) ?? [];
      for (const child of children) {
        const degree = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, degree);
        if (degree === 0) {
          next.push(child);
        }
      }
    }

    ready = next;
  }

  if (seenCount !== tasks.length) {
    const unresolved = tasks
      .filter((task) => (inDegree.get(task.id) ?? 0) > 0)
      .map((task) => task.id);
    throw new Error(`cycle detected in pipeline: ${unresolved.join(", ")}`);
  }

  return levels;
}
