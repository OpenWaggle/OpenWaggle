/**
 * Prints the types `generate-extension-sdk-types.ts` reads from the extension SDK's type sources
 * as plain TypeScript: objects as `{ readonly field: T }`, arrays as `readonly T[]`, unions member
 * by member, and any nested type that is another public type by that type's name.
 */
import type { Checker, Symbol as TsSymbol, Type } from 'typescript/unstable/async'
import { SymbolFlags, TypeFlags } from 'typescript/unstable/async'

/**
 * TypeScript's `CheckFlags.Readonly`, which a property of a mapped type such as an Effect
 * `Struct` carries when it is readonly. The API exposes the flags but not their enum.
 */
const CHECK_FLAG_READONLY = 8
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u
/** `true` and `false`: a union holding both prints `boolean`. */
const BOOLEAN_LITERAL_COUNT = 2

/** A name the printer may use for a type, and the module that declares it. */
export interface NamedType {
  readonly name: string
  readonly typeId: number
  /** An object, or a union with an object member; other names print only in their own module. */
  readonly objectLike: boolean
  readonly module: string
  /** For a union, its members, so a union that contains them all prints the name. */
  readonly memberIds?: ReadonlySet<number>
}

function hasFlag(type: Type, flag: TypeFlags) {
  return (type.flags & flag) !== 0
}

function propertyKey(name: string) {
  return IDENTIFIER_PATTERN.test(name) ? name : JSON.stringify(name)
}

function wrapForArray(printed: string) {
  return /[|&]/u.test(printed) ? `(${printed})` : printed
}

const NULLISH_MEMBERS = new Set(['null', 'undefined'])

/**
 * Union members in a fixed order: TypeScript orders them by type id, which follows the order the
 * checker happened to create them in and changes between runs. Members sort by their printed
 * text, with `null` and `undefined` last, as people write them: `string | null`.
 */
function unionMemberOrder(left: string, right: string) {
  const nullish = Number(NULLISH_MEMBERS.has(left)) - Number(NULLISH_MEMBERS.has(right))
  if (nullish !== 0) return nullish
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function createTypePrinter(input: {
  readonly checker: Checker
  /** The specifier other modules import the printed module by. */
  readonly module: string
  readonly names: ReadonlyMap<number, NamedType>
}) {
  const { checker, module } = input
  /**
   * A literal union such as `'global' | 'project'` takes a name only in the module that declares
   * it: another schema with the same members means something else (a storage scope selector is
   * not a docs package scope kind).
   */
  const names = new Map(
    [...input.names].filter(([, named]) => named.objectLike || named.module === module),
  )
  const referencedNames = new Map<string, Set<string>>()
  let rootId: number | null = null
  const objectUnions = [...names.values()]
    .filter((named) => named.memberIds !== undefined)
    .toSorted((left, right) => (right.memberIds?.size ?? 0) - (left.memberIds?.size ?? 0))

  function reference(named: NamedType) {
    const moduleNames = referencedNames.get(named.module) ?? new Set<string>()
    moduleNames.add(named.name)
    referencedNames.set(named.module, moduleNames)
    return named.name
  }

  async function printUnionMembers(members: readonly Type[]) {
    const remaining = new Map(members.map((member) => [member.id, member]))
    const parts: string[] = []
    for (const named of objectUnions) {
      const memberIds = named.memberIds
      if (named.typeId === rootId || memberIds === undefined) continue
      if (![...memberIds].every((id) => remaining.has(id))) continue
      for (const id of memberIds) remaining.delete(id)
      parts.push(reference(named))
    }
    const rest = [...remaining.values()]
    const booleans = rest.filter((member) => hasFlag(member, TypeFlags.BooleanLiteral))
    for (const member of rest) {
      if (hasFlag(member, TypeFlags.BooleanLiteral) && booleans.length === BOOLEAN_LITERAL_COUNT) {
        if (member === booleans[0]) parts.push('boolean')
        continue
      }
      parts.push(await print(member))
    }
    return parts.toSorted(unionMemberOrder).join(' | ')
  }

  async function printProperty(property: TsSymbol) {
    const optional = (property.flags & SymbolFlags.Optional) !== 0
    const readonly = (property.checkFlags & CHECK_FLAG_READONLY) !== 0
    const propertyType = await checker.getTypeOfSymbol(property)
    if (propertyType === undefined) throw new Error(`No type for property ${property.name}.`)
    const printed = optional ? await printOptional(propertyType) : await print(propertyType)
    const doc = await checker.getDocumentationCommentOfSymbol(property)
    const comment = doc.length > 0 ? `/** ${doc.replaceAll('\n', ' ')} */\n` : ''
    return `${comment}${readonly ? 'readonly ' : ''}${propertyKey(property.name)}${optional ? '?' : ''}: ${printed}`
  }

  /** An optional property's type without the `undefined` its optionality adds. */
  async function printOptional(type: Type) {
    if (!type.isUnionType()) return print(type)
    const members = (await type.getTypes()).filter(
      (member) => !hasFlag(member, TypeFlags.Undefined),
    )
    const [only] = members
    if (members.length === 1 && only !== undefined) return print(only)
    const nonNullable = await checker.getNonNullableType(type)
    const named = nonNullable === undefined ? undefined : names.get(nonNullable.id)
    const hasNull = members.some((member) => hasFlag(member, TypeFlags.Null))
    return named !== undefined && !hasNull ? reference(named) : printUnionMembers(members)
  }

  async function printObject(type: Type) {
    if (type.isTypeReference() && (await checker.isArrayType(type))) {
      const [element] = await checker.getTypeArguments(type)
      if (element === undefined) throw new Error('An array type has no element type.')
      const symbol = await type.getSymbol()
      const prefix = symbol?.name === 'ReadonlyArray' ? 'readonly ' : ''
      return `${prefix}${wrapForArray(await print(element))}[]`
    }
    if (await checker.isTupleType(type)) return checker.typeToString(type)
    const properties = await checker.getPropertiesOfType(type)
    const indexInfos = await checker.getIndexInfosOfType(type)
    const [indexInfo] = indexInfos
    if (properties.length === 0 && indexInfos.length === 1 && indexInfo !== undefined) {
      const record = `Record<${await print(indexInfo.keyType)}, ${await print(indexInfo.valueType)}>`
      return indexInfo.isReadonly ? `Readonly<${record}>` : record
    }
    if (indexInfos.length > 0) throw new Error('An object mixes properties and index signatures.')
    const members = await Promise.all(properties.map(printProperty))
    // With a doc comment, one member per line, so the comment leads its member instead of
    // trailing the one before.
    return members.some((member) => member.startsWith('/**'))
      ? `{\n${members.join(';\n')}\n}`
      : `{ ${members.join('; ')} }`
  }

  async function print(type: Type): Promise<string> {
    const named = names.get(type.id)
    if (named !== undefined) return reference(named)
    if (type.isUnionType()) return printUnionMembers(await type.getTypes())
    if (type.isIntersectionType()) {
      const members = await Promise.all((await type.getTypes()).map(print))
      return members.join(' & ')
    }
    if (type.isObjectType()) return printObject(type)
    return checker.typeToString(type)
  }

  return {
    /** The declaration body of a public type, naming nested public types. */
    printRoot: async (type: Type) => {
      rootId = type.id
      if (type.isUnionType()) return printUnionMembers(await type.getTypes())
      return type.isObjectType() ? printObject(type) : print(type)
    },
    /** The name of a public type, recorded as a name the printed module imports. */
    reference,
    /** Modules the printed types name, with the names each one supplies. */
    referencedNames,
  }
}
