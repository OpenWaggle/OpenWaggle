# Project Configuration

OpenWaggle supports per-project configuration via a TOML file at `.openwaggle/config.toml` in your project root.

The file is optional. When absent or unparseable, OpenWaggle falls back to built-in defaults. Invalid values within a valid file are silently ignored — they don't break the rest of the config.

## File Location

```
your-project/
  .openwaggle/
    config.toml      # Project configuration
    skills/          # Project skills (see Skills section)
```

## Quality Presets

Quality presets control the sampling parameters sent to the LLM provider. OpenWaggle ships with three tiers — `low`, `medium`, and `high` — selectable from the composer toolbar.

### Built-in Defaults

| Preset | temperature | top_p | max_tokens |
|--------|-------------|-------|------------|
| low    | 0.25        | 0.9   | 1200       |
| medium | 0.4         | 0.95  | 2200       |
| high   | 0.55        | 1.0   | 4200       |

### Overriding Per Project

Override any subset of parameters for any tier. Unspecified fields keep their defaults.

```toml
[quality.low]
temperature = 0.1
max_tokens = 800

[quality.medium]
temperature = 0.3
max_tokens = 4000

[quality.high]
temperature = 0.7
top_p = 0.9
max_tokens = 8000
```

### Parameters

| Parameter     | Type   | Range       | Description                                                |
|---------------|--------|-------------|------------------------------------------------------------|
| `temperature` | number | 0.0 – 2.0  | Controls randomness. Lower = more deterministic.           |
| `top_p`       | number | 0.0 – 1.0  | Nucleus sampling threshold. Lower = fewer token choices.   |
| `max_tokens`  | number | 1 – 1000000 | Maximum tokens in the model response.                      |

Out-of-range values are silently ignored. Non-numeric values (e.g. `temperature = "high"`) are also ignored without affecting other valid fields in the same tier.

### How It Works

1. The user selects a quality preset (low/medium/high) in the composer toolbar
2. OpenWaggle loads built-in defaults for that tier
3. If `.openwaggle/config.toml` has overrides for that tier, they replace the defaults
4. The provider may further adjust parameters (e.g. reasoning models like GPT-5 and o-series strip temperature/top_p since they reject those parameters)

## Example

A minimal config that only increases max tokens for the high preset:

```toml
[quality.high]
max_tokens = 16000
```

A full config for a project that needs lower temperature across all tiers:

```toml
[quality.low]
temperature = 0.0
max_tokens = 1000

[quality.medium]
temperature = 0.2
max_tokens = 3000

[quality.high]
temperature = 0.4
top_p = 0.95
max_tokens = 8000
```

## Caching

The config file is cached by modification time. Edits to `config.toml` take effect on the next agent run without restarting the app.

## Future Configuration

The `.openwaggle/config.toml` file is designed to be extended. Future sections may include tool policies, skill defaults, and agent behavior settings. The parser uses `.loose()` validation, so unknown sections are silently ignored — forward-compatible by design.
