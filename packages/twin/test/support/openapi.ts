import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';

const specDir = new URL('../../spec/', import.meta.url);
const specs = new Map<string, any>();
const ajvs = new Map<string, Ajv>();
const validators = new Map<string, ValidateFunction>();

function loadSpec(file: string): any {
  let spec = specs.get(file);
  if (!spec) {
    spec = JSON.parse(readFileSync(new URL(file, specDir), 'utf8'));
    specs.set(file, spec);
  }
  return spec;
}

/** `/v1/billing/subscriptions/I-ABC` matches the template `/v1/billing/subscriptions/{id}`. */
function findTemplate(spec: any, path: string): string | null {
  const concrete = path.split('?')[0]!.split('/');
  for (const template of Object.keys(spec.paths)) {
    const parts = template.split('/');
    if (parts.length !== concrete.length) continue;
    if (parts.every((p, i) => (p.startsWith('{') && p.endsWith('}') ? concrete[i] !== '' : p === concrete[i]))) return template;
  }
  return null;
}

const escapePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Throws unless `body` is valid against the JSON response schema PayPal's OpenAPI file declares for
 * `method path` with `status`. A status the spec declares without a body (such as 204) must have no body.
 */
export function assertMatchesSpec(specFile: string, path: string, method: string, status: number, body: unknown): void {
  const spec = loadSpec(specFile);
  const template = findTemplate(spec, path);
  if (!template) throw new Error(`${specFile}: no path matches ${path}`);
  const operation = spec.paths[template][method.toLowerCase()];
  if (!operation) throw new Error(`${specFile}: ${template} has no ${method.toUpperCase()} operation`);
  const response = operation.responses?.[String(status)];
  if (!response) {
    throw new Error(`${specFile}: ${method.toUpperCase()} ${template} declares no ${status} response (declared: ${Object.keys(operation.responses ?? {}).join(', ')})`);
  }
  const schema = response.content?.['application/json']?.schema;
  if (!schema) {
    if (body !== undefined && body !== null && body !== '') throw new Error(`${method.toUpperCase()} ${template} ${status} should have no body`);
    return;
  }

  // ppaas formats and x-* keywords are PayPal-internal; shapes are checked, formats are not. unicodeRegExp is
  // off because PayPal's email pattern is not valid under the 'u' flag. Compiling a 300 KB spec is slow, so
  // the Ajv instance and each compiled validator are cached.
  let ajv = ajvs.get(specFile);
  if (!ajv) {
    ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, unicodeRegExp: false });
    ajv.addSchema(spec, "spec");
    ajvs.set(specFile, ajv);
  }
  const pointer = `spec#/paths/${escapePointer(template)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema`;
  const key = `${specFile}|${pointer}`;
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile({ $ref: pointer });
    validators.set(key, validate);
  }
  if (!validate(body)) {
    const problems = (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
    throw new Error(`${method.toUpperCase()} ${template} ${status} does not match ${specFile}: ${problems}`);
  }
}
