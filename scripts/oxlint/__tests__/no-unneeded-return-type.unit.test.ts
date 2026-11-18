import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { fixWithRule, lintWithRule } from './lint-rule.ts'

const RULE_NAME = 'openwaggle/no-unneeded-return-type'
const FILENAME = 'src/renderer/src/features/example/example-panel.tsx'

function lint(code: string) {
  return lintWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

function fix(code: string) {
  return fixWithRule(openwagglePlugin, RULE_NAME, code, FILENAME)
}

describe('openwaggle/no-unneeded-return-type', () => {
  it.each([
    [
      'an exported function',
      'export function load(id: string): Promise<Session> { return read(id) }\n',
      'export function load(id: string) { return read(id) }\n',
    ],
    [
      'an internal function',
      'function count(items: readonly string[]): number { return items.length }\n',
      'function count(items: readonly string[]) { return items.length }\n',
    ],
    [
      'a React component',
      'export function Panel(props: PanelProps): JSX.Element { return <div>{props.title}</div> }\n',
      'export function Panel(props: PanelProps) { return <div>{props.title}</div> }\n',
    ],
    [
      'a hook',
      'export function usePanel(): PanelState { return useStore(selectPanel) }\n',
      'export function usePanel() { return useStore(selectPanel) }\n',
    ],
    [
      'an arrow function',
      'export const double = (value: number): number => value * 2\n',
      'export const double = (value: number) => value * 2\n',
    ],
    [
      'a generic arrow function',
      'const first = <T,>(items: readonly T[]): T | undefined => items[0]\n',
      'const first = <T,>(items: readonly T[]) => items[0]\n',
    ],
    [
      'a function expression',
      'const read = async function (): Promise<void> { await load() }\n',
      'const read = async function () { await load() }\n',
    ],
    [
      'a class method, getter and static method',
      'class Store { get size(): number { return 0 } read(): string { return "" } static create(): Store { return new Store() } }\n',
      'class Store { get size() { return 0 } read() { return "" } static create() { return new Store() } }\n',
    ],
    [
      'a function that calls a method of the same name',
      'export function logPath(): string { return writer.logPath() }\n',
      'export function logPath() { return writer.logPath() }\n',
    ],
    [
      'a function named like an object key it builds',
      'function size(): Size { return { size: 1 } }\n',
      'function size() { return { size: 1 } }\n',
    ],
    [
      'an object method',
      'const api = { read(): string { return "" } }\n',
      'const api = { read() { return "" } }\n',
    ],
    ['a callback', 'items.map((item): string => item.name)\n', 'items.map((item) => item.name)\n'],
    [
      'a function that calls another function that does not call it back',
      'function outer(): number { return inner() }\nfunction inner(): number { return 1 }\n',
      'function outer() { return inner() }\nfunction inner() { return 1 }\n',
    ],
    [
      'a method that calls another method of the same name on another object',
      'class Cache { get(key: string): string | undefined { return this.map.get(key) } }\n',
      'class Cache { get(key: string) { return this.map.get(key) } }\n',
    ],
  ])('reports and removes the return type of %s', (_name, code, fixed) => {
    const messages = lint(code)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((message) => message.ruleId === RULE_NAME)).toBe(true)
    expect(fix(code)).toBe(fixed)
  })

  it('reports each annotated function in a nest, outer and inner', () => {
    expect(fix('function outer(): () => number { return (): number => 1 }\n')).toBe(
      'function outer() { return () => 1 }\n',
    )
  })

  it.each([
    [
      'a type predicate',
      'function isText(part: Part): part is TextPart { return part.type === "text" }\n',
    ],
    [
      'an arrow type predicate',
      'const isText = (part: Part): part is TextPart => part.type === "text"\n',
    ],
    [
      'an assertion signature',
      'function assertText(part: Part): asserts part is TextPart { check(part) }\n',
    ],
    [
      'a bare assertion signature',
      'function assertDefined(value: unknown): asserts value { check(value) }\n',
    ],
    [
      'an overload implementation',
      'export function parse(input: string): Value\nexport function parse(input: Buffer): Value\nexport function parse(input: string | Buffer): Value { return decode(input) }\n',
    ],
    [
      'an overloaded method implementation',
      'class Reader { read(input: string): string\n read(input: number): number\n read(input: string | number): string | number { return input } }\n',
    ],
    [
      'a recursive function',
      'function depth(node: TreeNode): number { return 1 + Math.max(0, ...node.children.map(depth)) }\n',
    ],
    [
      'a recursive arrow function',
      'const depth = (node: TreeNode): number => 1 + Math.max(0, ...node.children.map(depth))\n',
    ],
    [
      'mutually recursive functions',
      'function parseOr(): Node { return parseAnd() }\nfunction parseAnd(): Node { return next() ? parseOr() : leaf() }\n',
    ],
    [
      'mutually recursive methods',
      'class Store { read(): Layer | undefined { return this.takeLegacy() } private takeLegacy(): Layer | undefined { return this.read() } }\n',
    ],
    [
      'a recursive method',
      'class Tree { size(node: TreeNode): number { return 1 + node.children.reduce((sum, child) => sum + this.size(child), 0) } }\n',
    ],
    ['an abstract method', 'abstract class Store { abstract read(): string }\n'],
    ['an interface method', 'interface Store { read(): string; write: (value: string) => void }\n'],
    ['a function type', 'type Read = (id: string) => Promise<string>\n'],
    ['a declare function', 'declare function read(id: string): string\n'],
    ['a declare module', "declare module 'example' { export function read(id: string): string }\n"],
    ['a function without a return type', 'export function read(id: string) { return id }\n'],
  ])('allows %s', (_name, code) => {
    expect(lint(code)).toHaveLength(0)
  })
})
