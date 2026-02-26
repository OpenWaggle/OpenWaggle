# Common React Doctor Fix Patterns

Fix patterns for the most frequent diagnostics in this project (React 19 + React Compiler + Electron).

## React Compiler Errors

### "Cannot access refs during render"

Reading `ref.current` during the render phase prevents compiler optimization.

```tsx
// Bad: ref read during render
function Component() {
  const ref = useRef<HTMLDivElement>(null)
  const width = ref.current?.offsetWidth ?? 0  // render-time read
  return <div ref={ref} style={{ minWidth: width }} />
}

// Good: read ref in effect, store result in state
function Component() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth)
  }, [])
  return <div ref={ref} style={{ minWidth: width }} />
}

// Good: read ref in event handler
function Component() {
  const ref = useRef<HTMLDivElement>(null)
  function handleClick() {
    console.log(ref.current?.offsetWidth)
  }
  return <div ref={ref} onClick={handleClick} />
}
```

### "Calling setState synchronously within an effect"

Synchronous setState in an effect body causes cascading renders.

```tsx
// Bad: synchronous setState in effect
useEffect(() => {
  setLoading(false)
  setData(fetchedData)
}, [fetchedData])

// Good: derive loading from existing state
const loading = data === undefined

// Good: if setState is truly needed, ensure it's in a callback
useEffect(() => {
  const handler = () => setState(newValue)
  element.addEventListener('change', handler)
  return () => element.removeEventListener('change', handler)
}, [])
```

### "Todo: Support value blocks in try/catch"

The compiler cannot optimize conditional/optional chaining expressions inside try/catch blocks.

```tsx
// Bad: optional chaining inside try/catch
try {
  const result = await api.fetch()
  const name = result?.data?.name ?? 'default'
  setState(name)
} catch (err) {
  // ...
}

// Good: extract the value block outside try/catch
const result = await api.fetch().catch(() => null)
const name = result?.data?.name ?? 'default'
setState(name)

// Good: use explicit null checks instead of optional chaining
try {
  const result = await api.fetch()
  if (result && result.data && result.data.name) {
    setState(result.data.name)
  } else {
    setState('default')
  }
} catch (err) {
  // ...
}
```

## State & Effects Warnings

### "Derived state in useEffect — compute during render instead"

State that can be computed from props or other state should not use useEffect.

```tsx
// Bad: useEffect to sync derived state
const [fullName, setFullName] = useState('')
useEffect(() => {
  setFullName(`${firstName} ${lastName}`)
}, [firstName, lastName])

// Good: compute during render
const fullName = `${firstName} ${lastName}`
```

### "useState initialized from prop — derive during render"

When useState is initialized from a prop AND synced via useEffect, replace with derived state or key prop.

```tsx
// Bad: useState + useEffect sync
function Input({ value }: { value: string }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return <input value={local} onChange={(e) => setLocal(e.target.value)} />
}

// Good option 1: derive (when no local edits needed)
function Input({ value }: { value: string }) {
  return <input value={value} onChange={(e) => onUpdate(e.target.value)} />
}

// Good option 2: key prop (when component needs local state that resets)
// Parent: <Input key={externalValue} initialValue={externalValue} />
function Input({ initialValue }: { initialValue: string }) {
  const [local, setLocal] = useState(initialValue)
  return <input value={local} onChange={(e) => setLocal(e.target.value)} />
}

// Acceptable: controlled input with local draft (onBlur save pattern)
// This is a legitimate pattern for text fields that save on blur.
// Suppress with react-doctor.config.json if needed.
```

### "useState(fn()) — use lazy initialization"

Function calls in useState run on every render. Wrap in an arrow function for lazy initialization.

```tsx
// Bad: runs SupportedModelId() on every render
const [model, setModel] = useState(SupportedModelId('claude-sonnet-4-5'))

// Good: lazy initialization, runs once
const [model, setModel] = useState(() => SupportedModelId('claude-sonnet-4-5'))
```

### "setState(value + 1) — use functional update"

Direct state reads in setState can cause stale closures in event handlers or effects.

```tsx
// Bad: reads stale closure value
setCount(count + 1)

// Good: functional update always reads latest
setCount((prev) => prev + 1)
```

### "Multiple setState calls — consider useReducer"

5+ setState calls in a single effect or handler suggest the state is interrelated.

```tsx
// Bad: many setState calls for related state
useEffect(() => {
  setLoading(false)
  setData(result.data)
  setError(null)
  setTimestamp(Date.now())
  setRetryCount(0)
}, [result])

// Good: useReducer for interrelated state
const [state, dispatch] = useReducer(reducer, initialState)
useEffect(() => {
  dispatch({ type: 'FETCH_SUCCESS', payload: result.data })
}, [result])
```

## Architecture Warnings

### "Component is N lines — consider splitting"

Components over ~250 lines should be decomposed into focused sub-components.

### "N useState calls — consider useReducer"

Components with 10+ useState calls should group related state into useReducer or extract sub-components with their own state.
