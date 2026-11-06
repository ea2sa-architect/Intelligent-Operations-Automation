/**
 * Lightweight BPMN 2.0 XML parser — no external dependencies.
 *
 * Scans BPMN XML by regex to extract flow elements and classify them into
 * governance types using Camunda connector job types (Zeebe extensions, C8)
 * or element-type heuristics (C7 / vanilla BPMN).
 */

const FLOW_TYPES = new Set([
  'startEvent', 'endEvent', 'serviceTask', 'userTask', 'scriptTask',
  'sendTask', 'receiveTask', 'businessRuleTask', 'manualTask', 'task',
  'callActivity', 'subProcess', 'transaction', 'adHocSubProcess',
  'exclusiveGateway', 'inclusiveGateway', 'parallelGateway',
  'eventBasedGateway', 'complexGateway',
  'boundaryEvent', 'intermediateThrowEvent', 'intermediateCatchEvent',
  'dataObjectReference', 'dataStoreReference',
]);

// Camunda connector job-type prefix → governance classification
const CONNECTOR_GOV = new Map([
  ['io.camunda:http-connector',         'http'],
  ['io.camunda:rest-connector',         'http'],
  ['io.camunda:graphql-connector',      'http'],
  ['io.camunda:openai-connector',       'ai_inference'],
  ['io.camunda:aws-bedrock',            'ai_inference'],
  ['io.camunda:anthropic-connector',    'ai_inference'],
  ['io.camunda:azure-openai-connector', 'ai_inference'],
  ['io.camunda:sql-connector',          'database'],
  ['io.camunda:aws-dynamodb',           'database'],
  ['io.camunda:slack-connector',        'notification'],
  ['io.camunda:sendgrid-connector',     'notification'],
  ['io.camunda:twilio-connector',       'notification'],
  ['io.camunda:microsoft-teams',        'notification'],
  ['io.camunda:aws-sns-connector',      'notification'],
  ['io.camunda:kafka-connector',        'webhook'],
  ['io.camunda:rabbitmq-connector',     'webhook'],
  ['io.camunda:aws-sqs-connector',      'webhook'],
  ['io.camunda:aws-s3-connector',       'storage'],
  ['io.camunda:google-drive-connector', 'storage'],
  ['io.camunda:aws-lambda-connector',   'arbitrary_code_execution'],
]);

function govTypeForConnector(jobType) {
  if (!jobType) return null;
  for (const [prefix, gov] of CONNECTOR_GOV) {
    if (jobType === prefix || jobType.startsWith(prefix + ':')) return gov;
  }
  return null;
}

// Find all BPMN flow element opening tags in the XML string.
function scanElements(xml) {
  // Matches: <[optional-ns:]elementName [attrs]>  or self-closing
  const TAG_RE = /<(?:[a-zA-Z]+:)?(\w+)\b([^>]*?)(?:\s*\/?>)/g;
  const results = [];
  let m;
  while ((m = TAG_RE.exec(xml)) !== null) {
    const localName = m[1];
    if (!FLOW_TYPES.has(localName)) continue;
    results.push({
      type:      localName,
      id:        /\bid="([^"]+)"/.exec(m[2])?.[1] ?? null,
      name:      /\bname="([^"]+)"/.exec(m[2])?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<') ?? null,
      rawAttrs:  m[2],
      offset:    m.index,
      endOffset: m.index + m[0].length,
    });
  }
  return results;
}

// Find the Zeebe job type for a C8 service task.
// Looks in a 2 kB window starting at the element's closing >.
function findZeebeJobType(xml, fromOffset) {
  const chunk = xml.slice(fromOffset, fromOffset + 2000);
  return /(?:zeebe:)?taskDefinition\b[^>]*\btype="([^"]+)"/.exec(chunk)?.[1] ?? null;
}

// Extract Camunda 7 implementation hints from element attributes.
function findC7Impl(rawAttrs) {
  return (
    /camunda:class="([^"]+)"/.exec(rawAttrs)?.[1] ??
    /camunda:delegateExpression="([^"]+)"/.exec(rawAttrs)?.[1] ??
    /camunda:topic="([^"]+)"/.exec(rawAttrs)?.[1] ??
    null
  );
}

// Classify one BPMN element into a governance node.
function classifyElement(el, xml) {
  const { type, rawAttrs, endOffset } = el;
  let govType = 'unknown';
  let jobType  = null;
  const risks  = [];

  switch (type) {
    case 'serviceTask': {
      jobType = findZeebeJobType(xml, endOffset) ?? findC7Impl(rawAttrs);
      govType = govTypeForConnector(jobType) ?? 'http';
      if (govType === 'ai_inference')              risks.push('unreviewed_ai_output');
      if (govType === 'arbitrary_code_execution')  risks.push('arbitrary_code_execution');
      if (govType === 'http') {
        // No timeout configured is common in BPMN — flag it
        if (!/retries|timeout/.test(rawAttrs + xml.slice(endOffset, endOffset + 1000))) {
          risks.push('no_timeout');
        }
      }
      break;
    }
    case 'scriptTask':
      govType = 'arbitrary_code_execution';
      risks.push('arbitrary_code_execution');
      break;
    case 'userTask':
      govType = 'approval';
      break;
    case 'sendTask':
      govType = 'notification';
      break;
    case 'receiveTask':
      govType = 'webhook';
      break;
    case 'callActivity':
      govType = 'http';
      break;
    case 'businessRuleTask':
      govType = 'logic';
      break;
    case 'startEvent':
    case 'intermediateCatchEvent': {
      const chunk = xml.slice(endOffset, endOffset + 500);
      if      (/timerEventDefinition/.test(chunk))   govType = 'schedule';
      else if (/messageEventDefinition/.test(chunk)) govType = 'webhook';
      else if (/signalEventDefinition/.test(chunk))  govType = 'webhook';
      else                                            govType = 'webhook';
      break;
    }
    case 'intermediateThrowEvent':
    case 'endEvent':
    case 'exclusiveGateway':
    case 'inclusiveGateway':
    case 'parallelGateway':
    case 'eventBasedGateway':
    case 'complexGateway':
    case 'boundaryEvent':
    case 'subProcess':
    case 'adHocSubProcess':
    case 'transaction':
      govType = 'logic';
      break;
    case 'dataStoreReference':
    case 'dataObjectReference':
      govType = 'storage';
      break;
    default:
      govType = 'unknown';
  }

  return {
    id:              el.id,
    node_id:         el.id,
    node_name:       el.name || type,
    n8n_type:        jobType ?? type,
    governance_type: govType,
    risk_factors:    risks,
    parameters_json: {},
    disabled:        false,
    credentials:     {},
  };
}

/**
 * Parse a BPMN XML string.
 * @returns {{ nodes: object[], processId: string|null, processName: string }}
 */
export function parseBpmn(xml) {
  const pm = (
    /<(?:[a-zA-Z]+:)?process\b[^>]*\bid="([^"]+)"[^>]*(?:\bname="([^"]+)")?/.exec(xml) ??
    /<(?:[a-zA-Z]+:)?process\b[^>]*\bname="([^"]+)"/.exec(xml)
  );
  const processId   = pm?.[1] ?? null;
  const processName = pm?.[2] ?? processId ?? 'Unknown Process';

  const rawElements = scanElements(xml);
  const nodes = rawElements.map(el => classifyElement(el, xml));

  return { nodes, processId, processName };
}
