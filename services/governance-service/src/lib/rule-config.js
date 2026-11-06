// Rule-config validation against governance.rule_schemas.schema_json.
//
// One implementation, two callers: POST /policies/:id/rules (so a rule created
// in the SPA or the ioa CLI is held to the same standard as an imported one)
// and policy-bundle import. Until now nothing checked config_json against the
// schema — rule_schemas only drove form rendering.
//
// `severity` fields are skipped here: policy_rules keeps severity in its own
// column, and both the SPA's RuleBuilder and the CLI's collectRuleAnswers pull
// it out of config_json before sending, so it is validated as a rule-level
// field by the caller.

export const RULE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.:/()-]{0,127}$/;

export const CONFIG_LIMITS = { maxBytes: 16 * 1024, maxDepth: 8, maxString: 2000 };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Walks a JSON value once: depth, forbidden keys, and total serialized size.
// Returns an error string or null.
export function checkJsonShape(value, { maxBytes, maxDepth } = CONFIG_LIMITS) {
  let size;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    return 'is not valid JSON';
  }
  if (size > maxBytes) return `is too large (${size} bytes, max ${maxBytes})`;

  const walk = (v, depth) => {
    if (depth > maxDepth) return `is nested deeper than ${maxDepth} levels`;
    if (Array.isArray(v)) {
      for (const item of v) { const e = walk(item, depth + 1); if (e) return e; }
    } else if (isPlainObject(v)) {
      for (const [k, item] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k)) return `contains forbidden key "${k}"`;
        const e = walk(item, depth + 1);
        if (e) return e;
      }
    }
    return null;
  };
  return walk(value, 1);
}

function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

// Returns [{ path, message }]. `schemaJson` is rule_schemas.schema_json
// ({ fields: [{ name, type, options, required }] }); a rule type with no field
// list has nothing to validate against, so it passes.
export function validateRuleConfig(schemaJson, config, path = 'config') {
  const errors = [];
  const fields = Array.isArray(schemaJson?.fields) ? schemaJson.fields : null;
  if (!fields) return errors;

  if (!isPlainObject(config)) {
    return [{ path, message: 'must be an object' }];
  }
  const shapeErr = checkJsonShape(config);
  if (shapeErr) return [{ path, message: shapeErr }];

  const byName = new Map(fields.filter(f => f.type !== 'severity').map(f => [f.name, f]));

  for (const key of Object.keys(config)) {
    if (!byName.has(key)) errors.push({ path: `${path}.${key}`, message: 'is not a field of this rule type' });
  }

  for (const [name, field] of byName) {
    const value = config[name];
    const here = `${path}.${name}`;

    if (isEmpty(value)) {
      if (field.required) errors.push({ path: here, message: 'is required' });
      continue;
    }

    const options = Array.isArray(field.options) ? field.options.map(String) : null;
    switch (field.type) {
      case 'enum':
        // Some catalog enums are the strings "true"/"false"; accept the
        // matching boolean too, since stored configs may hold either.
        if (typeof value === 'object' || (options && !options.includes(String(value)))) {
          errors.push({ path: here, message: `must be one of: ${options?.join(', ')}` });
        }
        break;
      case 'multi_enum':
        if (!Array.isArray(value) || value.some(v => typeof v === 'object' || (options && !options.includes(String(v))))) {
          errors.push({ path: here, message: `must be a list drawn from: ${options?.join(', ')}` });
        }
        break;
      case 'json_array':
        if (!Array.isArray(value)) errors.push({ path: here, message: 'must be a list' });
        break;
      case 'string':
        if (typeof value !== 'string') errors.push({ path: here, message: 'must be a string' });
        else if (value.length > CONFIG_LIMITS.maxString) errors.push({ path: here, message: `must be at most ${CONFIG_LIMITS.maxString} characters` });
        break;
      default:
        break; // unknown field type: present-and-allowed is all we can check
    }
  }
  return errors;
}
