import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Professional services workflow v2_1 - Drive Report Delivery
// Nodes   : 35  |  Connections: 26
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// WebhookInboundPdfDocx              webhook                    [creds]
// ExtractPdfText                     extractFromFile
// NormalizeExtractedText             code
// AiLeadExtractor                    agent                      [AI]
// ParseExtractedLeadJson             code
// AiLeadScorer                       agent                      [AI]
// ParseScoredLeadJson                code
// Score70                            if
// CreateOrUpdateAContact             zohoCrm                    [creds]
// HubspotCrmCreateUpdate             hubspot                    [creds]
// ProposalDraftGenerator             agent                      [AI]
// NormalizeProposalDraft             code
// MergeProposalWithLeadData          code
// ProposalQualityGate                agent                      [AI]
// MergeQualityGateWithProposal       code
// ProposalApproved                   if
// HtmlEmailFormatter                 agent                      [AI]
// ParseHtmlEmailJson                 code
// SimpleMemory                       memoryBufferWindow         [ai_memory]
// OpenaiChatModelExtract             lmChatOpenAi               [creds] [ai_languageModel]
// OpenaiChatModelScore               lmChatOpenAi               [creds] [ai_languageModel]
// OpenaiChatModelProposal            lmChatOpenAi               [creds] [ai_languageModel]
// OpenaiChatModelQuality             lmChatOpenAi               [creds] [ai_languageModel]
// OpenaiChatModelHtml                lmChatOpenAi               [creds] [ai_languageModel]
// PrepareStarterNurtureEmail         set
// SendAMessage                       gmail                      [creds]
// SimpleMemory1                      memoryBufferWindow
// PushAMessageInPushover             pushoverTool               [creds] [ai_tool]
// PrepareReportFileForDrive          code
// GoogleDriveUploadReportFile        googleDrive                [creds]
// GoogleDriveShareReportFile         googleDrive                [creds]
// BuildDriveResponsePayload          code
// HttpResponseReportComplete         respondToWebhook
// SendReportReadyNotification        gmail                      [creds]
// HttpResponseStarterNurtureComplete respondToWebhook
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WebhookInboundPdfDocx
//    → ExtractPdfText
//      → NormalizeExtractedText
//        → AiLeadExtractor
//          → ParseExtractedLeadJson
//            → AiLeadScorer
//              → ParseScoredLeadJson
//                → Score70
//                  → CreateOrUpdateAContact
//                  → HubspotCrmCreateUpdate
//                  → ProposalDraftGenerator
//                    → NormalizeProposalDraft
//                      → MergeProposalWithLeadData
//                        → ProposalQualityGate
//                          → MergeQualityGateWithProposal
//                            → ProposalApproved
//                              → HtmlEmailFormatter
//                                → ParseHtmlEmailJson
//                                  → PrepareReportFileForDrive
//                                    → GoogleDriveUploadReportFile
//                                      → GoogleDriveShareReportFile
//                                        → BuildDriveResponsePayload
//                                          → HttpResponseReportComplete
//                                          → SendReportReadyNotification
//                 .out(1) → PrepareStarterNurtureEmail
//                    → SendAMessage
//                      → HttpResponseStarterNurtureComplete
//
// AI CONNECTIONS
// AiLeadExtractor.uses({ ai_languageModel: OpenaiChatModelExtract })
// AiLeadScorer.uses({ ai_languageModel: OpenaiChatModelScore })
// ProposalDraftGenerator.uses({ ai_languageModel: OpenaiChatModelProposal, ai_memory: SimpleMemory })
// ProposalQualityGate.uses({ ai_languageModel: OpenaiChatModelQuality })
// HtmlEmailFormatter.uses({ ai_languageModel: OpenaiChatModelHtml, ai_tool: [PushAMessageInPushover] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: '1MjCMJa7eH1opWTx',
    name: 'Professional services workflow v2_1 - Drive Report Delivery',
    active: true,
    isArchived: false,
    projectId: 'Ty510WNb6tNHkgmk',
    projectName: 'Gary Shepard <gary@ea2sa.org>',
    homeProject: {
        id: 'Ty510WNb6tNHkgmk',
        name: 'Gary Shepard <gary@ea2sa.org>',
        type: 'personal',
        createdAt: '2025-11-21T17:06:03.227Z',
        updatedAt: '2025-11-21T17:06:08.305Z',
    },
    settings: {
        executionOrder: 'v1',
        binaryMode: 'separate',
        availableInMCP: true,
        timeSavedMode: 'fixed',
        callerPolicy: 'workflowsFromSameOwner',
    },
})
export class ProfessionalServicesWorkflowV21DriveReportDeliveryWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: '4767c02d-f551-4cc6-bd0c-dec5e4ae34be',
        webhookId: 'b0890cd8-f707-4abd-949d-2aa472e4edba',
        name: 'Webhook (Inbound PDF/DOCX)',
        type: 'n8n-nodes-base.webhook',
        version: 2.1,
        position: [-12592, 1472],
        credentials: { httpHeaderAuth: { id: 'rlULawOWlJ67tIKg', name: 'Header Auth n8n-Professional Services' } },
    })
    WebhookInboundPdfDocx = {
        httpMethod: 'POST',
        path: 'd9d5c75f-80fe-4ed3-8668-d10500ce8c82',
        authentication: 'headerAuth',
        responseMode: 'responseNode',
        options: {},
    };

    @node({
        id: 'd5e8d5cc-88bf-49f1-8fe1-57dc3076051d',
        name: 'Extract PDF Text',
        type: 'n8n-nodes-base.extractFromFile',
        version: 1.1,
        position: [-12224, 1472],
    })
    ExtractPdfText = {
        operation: 'pdf',
        options: {
            joinPages: true,
        },
    };

    @node({
        id: '08e41dc7-8b8f-49f8-b665-9b771b62cdf8',
        name: 'Normalize Extracted Text',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-11856, 1472],
    })
    NormalizeExtractedText = {
        jsCode: `const item = $input.all()[0] || { json: {}, binary: {} };
const j = item.json || {};

// Reference original webhook payload by exact node name
let webhookJson = {};

try {
  webhookJson = $("Webhook (Inbound PDF/DOCX)").first().json || {};
} catch (error) {
  webhookJson = {};
}

/**
 * Normalize extracted PDF/document text into one stable field: inputText
 */
let inputText =
  j.inputText ??
  j.text ??
  j.data ??
  j.content ??
  j.extractedText ??
  j.documentText ??
  j.markdown ??
  null;

if (!inputText && Array.isArray(j.pages)) {
  inputText = j.pages.join("\\n\\n");
}

if (!inputText && j.output) {
  inputText =
    typeof j.output === "string"
      ? j.output
      : JSON.stringify(j.output);
}

if (!inputText) {
  inputText = JSON.stringify(j);
}

/**
 * Capture email from current item first,
 * then from the original webhook payload,
 * then from the extracted PDF text.
 */
let userEmail =
  j.userEmail ??
  j.body?.email ??
  j.email ??
  j.query?.email ??
  j.params?.email ??
  webhookJson.body?.email ??
  webhookJson.email ??
  null;

if (!userEmail && inputText) {
  const emailMatch = inputText.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i
  );

  userEmail = emailMatch ? emailMatch[0] : null;
}

/**
 * Capture name from current item first,
 * then from the original webhook payload,
 * then from extracted text.
 */
let userName =
  j.userName ??
  j.body?.name ??
  j.name ??
  j.query?.name ??
  j.params?.name ??
  webhookJson.body?.name ??
  webhookJson.name ??
  null;

if (!userName && inputText) {
  const nameMatch = inputText.match(/Contact:\\s*(.+)/i);
  userName = nameMatch ? nameMatch[1].trim() : null;
}

return [
  {
    json: {
      ...j,
      userEmail,
      userName,
      inputText
    },
    binary: item.binary
  }
];`,
    };

    @node({
        id: 'f1641182-2515-4bba-8510-7244a9d85bc2',
        name: 'AI Lead Extractor',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-11600, 1472],
    })
    AiLeadExtractor = {
        promptType: 'define',
        text: `=You are an expert B2B lead intake analyst for an Enterprise AI automation consulting firm.

Your task is to extract structured lead data from the incoming proposal or intake document.

Return raw valid JSON only.
Do not include Markdown.
Do not wrap the JSON in code fences.
Do not include explanations.
Do not invent missing facts.
Do not use example data.
Do not infer facts that are not present in the source document.
If a field is missing, use null for scalar fields or an empty array for list fields.

The first character of your response must be {.
The last character of your response must be }.

Extraction rules:
1. Use the exact company name from the source document.
2. Use the exact contact name, email, and role from the source document.
3. Preserve all numeric details, including document volume, processing delay, budget, timeline, and frequency.
4. Preserve system details, especially legacy systems, databases, CRM platforms, ERP platforms, or on-premises systems.
5. Preserve specific validation requirements, especially price, volume, data quality, approval, compliance, or exception-review requirements.
6. Do not replace the client company with placeholders such as XYZ Corporation, Acme, Client, or example company names.
7. Do not add recommended capabilities unless the source document explicitly asks for them.
8. If the timeline is stated as within the next 6 months, preserve that wording exactly.
9. If the budget is stated as a range, preserve both the minimum and maximum.
10. If any important field cannot be found, add a short warning to extractionWarnings.
11. Do not assign a service tier in this step.
12. Do not calculate a lead score in this step.

Required JSON output shape:
{
  "companyName": null,
  "contact": {
    "name": null,
    "email": null,
    "role": null
  },
  "businessContext": null,
  "painPoints": [],
  "documentVolume": {
    "quantity": null,
    "frequency": null,
    "documentTypes": []
  },
  "processingDelay": null,
  "currentSystems": [],
  "currentProcess": null,
  "targetArchitectureRequirements": [],
  "validationRequirements": [],
  "timeline": null,
  "budget": {
    "min": null,
    "max": null,
    "currency": "USD"
  },
  "authoritySignal": null,
  "needSignal": null,
  "extractionWarnings": []
}

Source document:
{{ $json.inputText }}`,
        hasOutputParser: true,
        options: {
            maxIterations: 3,
        },
    };

    @node({
        id: 'dc54ac1e-e035-488d-b0df-4405039ef928',
        name: 'Parse Extracted Lead JSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-11280, 1472],
    })
    ParseExtractedLeadJson = {
        jsCode: `function parseAiJson(value) {
  let raw = value;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.output === "string") raw = raw.output;
    else if (typeof raw.text === "string") raw = raw.text;
    else if (typeof raw.response === "string") raw = raw.response;
    else return raw;
  }

  if (typeof raw !== "string") {
    throw new Error("AI output was not a string or object.");
  }

  let clean = raw.trim()
    .replace(/^\`\`\`json\\s*/i, "")
    .replace(/^\`\`\`\\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  const parsed = JSON.parse(clean);

  if (parsed && typeof parsed.output === "string") {
    return parseAiJson(parsed.output);
  }

  return parsed;
}

const item = $input.all()[0] || { json: {} };
const parsed = parseAiJson(item.json);

return [{ json: parsed }];`,
    };

    @node({
        id: 'ee8a5b89-5d77-457c-a6d7-ab128ef705b2',
        name: 'AI Lead Scorer',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-11024, 1472],
    })
    AiLeadScorer = {
        promptType: 'define',
        text: `=You are an Enterprise AI Solutions Architect and B2B Sales Strategist.

Your task is to evaluate the structured lead data from Step 1 and assign a lead score and service tier.

Return raw valid JSON only.
Do not include Markdown.
Do not wrap the JSON in code fences.
Do not include explanations outside the JSON.
Do not remove facts from the Step 1 extraction.
Do not rename fields from the Step 1 extraction.

The first character of your response must be {.
The last character of your response must be }.

Scoring model:
- Budget: 0-30 points
- Authority: 0-20 points
- Need: 0-30 points
- Timeline: 0-20 points

Budget scoring:
- 30 = Budget maximum is $75,000 or higher
- 20 = Budget maximum is $25,000-$74,999
- 10 = Budget maximum is below $25,000
- 0 = No budget stated
If a budget range is provided, score based on the maximum budget value.

Authority scoring:
- 20 = Senior executive, VP, C-level officer, owner, founder, partner, or direct budget authority
- 10 = Manager, director, department lead, or strong internal influencer
- 0 = No authority signal
Use contact.role and authoritySignal.

Need scoring:
- 30 = Clear operational pain with measurable volume, delay, error rate, financial impact, compliance risk, or customer impact
- 20 = Clear operational pain but limited measurable detail
- 10 = General improvement interest only
- 0 = No clear business need
Use painPoints, documentVolume, processingDelay, currentProcess, and needSignal.

Timeline scoring:
- 20 = Timeline is 0-6 months or says within the next 6 months
- 10 = Timeline is 6-12 months
- 5 = Timeline is beyond 12 months
- 0 = No timeline stated
If the timeline says within the next 6 months, the timeline score must be 20.

Service tier assignment:
- Enterprise Tier = 75-100
- Growth Tier = 50-74
- Starter Tier = below 50

Create proposalMustInclude with all facts the proposal writer must preserve. Include company name, contact name, contact role, pain points, document volume, processing delay, current systems, target architecture requirements, validation requirements, timeline, budget range, and service tier when present.

Required JSON output shape:
{
  "companyName": null,
  "contact": {
    "name": null,
    "email": null,
    "role": null
  },
  "businessContext": null,
  "painPoints": [],
  "documentVolume": {
    "quantity": null,
    "frequency": null,
    "documentTypes": []
  },
  "processingDelay": null,
  "currentSystems": [],
  "currentProcess": null,
  "targetArchitectureRequirements": [],
  "validationRequirements": [],
  "timeline": null,
  "budget": {
    "min": null,
    "max": null,
    "currency": "USD"
  },
  "authoritySignal": null,
  "needSignal": null,
  "serviceTierAssignment": null,
  "scoringCriteria": {
    "budget": null,
    "authority": null,
    "need": null,
    "timeline": null,
    "totalScore": null
  },
  "qualificationSummary": null,
  "proposalMustInclude": [],
  "qualificationWarnings": []
}

Input JSON from Step 1:
{{ JSON.stringify($json, null, 2) }}`,
        hasOutputParser: true,
        options: {
            maxIterations: 3,
        },
    };

    @node({
        id: 'd39c7e06-b9c4-4533-baba-4040ee3c5f17',
        name: 'Parse Scored Lead JSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-10704, 1472],
    })
    ParseScoredLeadJson = {
        jsCode: `function scoreBudget(budget) {
  const max = Number(budget?.max ?? 0);
  if (!max) return 0;
  if (max >= 75000) return 30;
  if (max >= 25000) return 20;
  return 10;
}

function scoreAuthority(role, authoritySignal) {
  const text = \`\${role || ""} \${authoritySignal || ""}\`.toLowerCase();
  if (/(cto|cio|ceo|cfo|coo|chief|vp|vice president|owner|founder|partner|president|executive)/.test(text)) return 20;
  if (/(director|manager|lead|head|supervisor|influencer)/.test(text)) return 10;
  return 0;
}

function scoreNeed(j) {
  const pain = Array.isArray(j.painPoints) ? j.painPoints.join(" ") : "";
  const text = \`\${pain} \${j.processingDelay || ""} \${j.currentProcess || ""} \${j.needSignal || ""}\`.toLowerCase();
  const hasMeasurable = Boolean(j.documentVolume?.quantity) || /\\d|delay|error|audit|financial|reconciliation|compliance|customer|risk|volume/.test(text);
  if (pain || text.trim()) return hasMeasurable ? 30 : 20;
  return 0;
}

function scoreTimeline(timeline) {
  const text = String(timeline || "").toLowerCase();
  if (!text || text === "null") return 0;
  if (/within.*6\\s*months|next\\s*6\\s*months|0\\s*-\\s*6|six\\s*months|6\\s*months/.test(text)) return 20;
  if (/6\\s*-\\s*12|12\\s*months|year/.test(text)) return 10;
  return 5;
}

function parseAiJson(value) {
  let raw = value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.output === "string") raw = raw.output;
    else if (typeof raw.text === "string") raw = raw.text;
    else if (typeof raw.response === "string") raw = raw.response;
    else return raw;
  }

  let clean = String(raw).trim()
    .replace(/^\`\`\`json\\s*/i, "")
    .replace(/^\`\`\`\\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}

const item = $input.all()[0] || { json: {} };
const j = parseAiJson(item.json);

const aiCriteria = j.scoringCriteria || {};
const budget = Number(aiCriteria.budget ?? scoreBudget(j.budget));
const authority = Number(aiCriteria.authority ?? scoreAuthority(j.contact?.role, j.authoritySignal));
const need = Number(aiCriteria.need ?? scoreNeed(j));
const timeline = Number(aiCriteria.timeline ?? scoreTimeline(j.timeline));
const totalScore = budget + authority + need + timeline;

let serviceTierAssignment = j.serviceTierAssignment;
if (!serviceTierAssignment) {
  serviceTierAssignment = totalScore >= 75 ? "Enterprise Tier" : totalScore >= 50 ? "Growth Tier" : "Starter Tier";
}

return [
  {
    json: {
      ...j,
      serviceTierAssignment,
      scoringCriteria: {
        budget,
        authority,
        need,
        timeline,
        totalScore
      },
      proposalMustInclude: Array.isArray(j.proposalMustInclude) ? j.proposalMustInclude : []
    }
  }
];`,
    };

    @node({
        id: '1ff73c34-8ee0-4acc-aa20-b7de7f74c345',
        name: 'Score >= 70?',
        type: 'n8n-nodes-base.if',
        version: 2.2,
        position: [-10448, 1472],
    })
    Score70 = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 2,
            },
            conditions: [
                {
                    id: 'score-check',
                    leftValue: '={{ $json.scoringCriteria.totalScore }}',
                    operator: {
                        type: 'number',
                        operation: 'gte',
                    },
                    rightValue: 70,
                },
            ],
            combinator: 'and',
        },
        options: {},
    };

    @node({
        id: '05459c5f-9007-42a8-b16c-f01e0dabe689',
        name: 'Create or Update a contact',
        type: 'n8n-nodes-base.zohoCrm',
        version: 1,
        position: [-9888, 800],
        credentials: { zohoOAuth2Api: { id: 'qN4ZMnPBdb2zdALP', name: 'Zoho OAuth Accounts API' } },
    })
    CreateOrUpdateAContact = {
        resource: 'contact',
        operation: 'upsert',
        lastName: '={{ $json.contact.name ? $json.contact.name.split(" ").slice(1).join(" ") : "" }}',
        additionalFields: {
            Description: '={{ Array.isArray($json.painPoints) ? $json.painPoints.join(", ") : "" }}',
            Email: "={{ $('Webhook (Inbound PDF/DOCX)').item.json.body.email }}",
            Secondary_Email: '={{ $json.contact.email }}',
            First_Name: '={{ $json.contact.name ? $json.contact.name.split(" ")[0] : "" }}',
        },
    };

    @node({
        id: '9578820c-f08d-41f2-bf79-441fedd5ce98',
        name: 'HubSpot CRM Create/Update',
        type: 'n8n-nodes-base.hubspot',
        version: 2.2,
        position: [-9840, 1136],
        credentials: { hubspotOAuth2Api: { id: 'XiGPJ7kGGARrdFgG', name: 'HubSpot account' } },
    })
    HubspotCrmCreateUpdate = {
        authentication: 'oAuth2',
        email: "={{ $('Webhook (Inbound PDF/DOCX)').item.json.body.email }}",
        additionalFields: {
            firstName: '={{ $json.contact.name ? $json.contact.name.split(" ")[0] : "" }}',
            lastName: '={{ $json.contact.name ? $json.contact.name.split(" ").slice(1).join(" ") : "" }}',
            memberEmail: '={{ $json.contact.email }}',
            message: '={{ Array.isArray($json.painPoints) ? $json.painPoints.join(", ") : "" }} ',
        },
        options: {},
    };

    @node({
        id: '3232bdbc-5189-4096-86e5-42b945c7ab6c',
        name: 'Proposal Draft Generator',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-10096, 1856],
    })
    ProposalDraftGenerator = {
        promptType: 'define',
        text: `=You are an expert Enterprise AI Solutions Architect and B2B Sales Strategist.

Draft a formal project proposal based only on the structured and scored lead JSON provided below.

Return the proposal as Markdown only.
Do not send an email.
Do not call any tools.
Do not invent facts.
Do not use placeholder company names such as XYZ Corporation.
Do not use generic fields like Client when the actual company name is available.

Tone: professional, strategic, authoritative, and collaborative.

Required rules:
1. Use the exact company name from companyName.
2. Address the proposal to the exact contact name from contact.name.
3. Mention the contact role from contact.role.
4. Include document volume when present.
5. Include processing delay when present.
6. Include current systems when present.
7. Include the budget range when present.
8. Include the timeline when present.
9. Include the assigned service tier.
10. Include validation requirements, especially price and volume discrepancy review, when present.
11. Position the work as a pilot when the input describes a pilot.
12. Do not claim guaranteed results.

Required proposal structure:
# Proposal for Intelligent Document Processing and Workflow Automation

## 1. Executive Summary
## 2. Problem Statement & Operational Friction Matrix
## 3. Proposed Solution Architecture: [service tier]
## 4. Delivery Roadmap & Timeline
## 5. Commercial Terms & Capital Allocation
## 6. Expected Business Outcomes
## 7. Closing Recommendation

For Commercial Terms:
- Include the stated budget range.
- Recommend a project scope fee within the budget range.
- If the range is 75000 to 100000, recommend 87500.
- Explain the fee as a pilot investment.

Input JSON:
{{ JSON.stringify($json, null, 2) }}`,
        hasOutputParser: true,
        options: {
            systemMessage: 'You draft proposal text only. You do not send emails and you do not call tools.',
            maxIterations: 3,
        },
    };

    @node({
        id: 'f3d299fc-c7c8-4d74-995e-47fbcdf9ad80',
        name: 'Normalize Proposal Draft',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-9776, 2288],
    })
    NormalizeProposalDraft = {
        jsCode: `const item = $input.all()[0] || { json: {} };
const j = item.json || {};
const proposalMarkdown =
  j.proposalMarkdown ??
  j.output ??
  j.text ??
  j.response ??
  "";

return [
  {
    json: {
      ...j,
      proposalMarkdown: typeof proposalMarkdown === "string" ? proposalMarkdown : JSON.stringify(proposalMarkdown)
    }
  }
];`,
    };

    @node({
        id: '16cf9d64-6162-4d85-9a73-32a57b73e724',
        name: 'Merge Proposal With Lead Data',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-9520, 2288],
    })
    MergeProposalWithLeadData = {
        jsCode: `const scoredItems = $items("Parse Scored Lead JSON");
const scoredLead = scoredItems?.[0]?.json;

if (!scoredLead) {
  throw new Error("Could not read data from 'Parse Scored Lead JSON'. Confirm that the scoring node executed before this merge node.");
}

const item = $input.all()[0] || { json: {} };
const proposal = item.json.proposalMarkdown ?? item.json.output ?? item.json.text ?? item.json.response ?? "";

return [
  {
    json: {
      ...scoredLead,
      proposalMarkdown: typeof proposal === "string" ? proposal : JSON.stringify(proposal)
    }
  }
];`,
    };

    @node({
        id: '286ce243-493c-4e81-bfb5-30064e900e9f',
        name: 'Proposal Quality Gate',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-9264, 2288],
    })
    ProposalQualityGate = {
        promptType: 'define',
        text: `=You are a proposal quality assurance reviewer.

Review the generated proposal against the structured lead data.

Return raw valid JSON only.
Do not include Markdown.
Do not wrap the JSON in code fences.
Do not include commentary outside the JSON.

Approval rule:
Set approvedToSend to true only if qualityScore is 69 or higher.
If company name, contact name, budget range, timeline, validation checkpoint, current system when provided, or document volume when provided is missing, approvedToSend must be false.

Check whether the proposal includes:
- Correct company name
- Correct contact name
- Correct contact role
- Correct document volume
- Correct processing delay
- Correct current system
- Correct pain points
- Correct target architecture requirements
- Correct validation requirements
- Correct timeline
- Correct budget range
- Correct service tier
- No placeholder company names
- No unsupported claims
- No missing commercial terms
- No missing human-in-the-loop checkpoint

Required JSON output shape:
{
  "approvedToSend": false,
  "qualityScore": null,
  "missingRequiredItems": [],
  "incorrectItems": [],
  "placeholderLeakage": [],
  "unsupportedClaims": [],
  "requiredRevisions": [],
  "finalRecommendation": null
}

Structured lead data:
{{ JSON.stringify({
  companyName: $json.companyName,
  contact: $json.contact,
  businessContext: $json.businessContext,
  painPoints: $json.painPoints,
  documentVolume: $json.documentVolume,
  processingDelay: $json.processingDelay,
  currentSystems: $json.currentSystems,
  currentProcess: $json.currentProcess,
  targetArchitectureRequirements: $json.targetArchitectureRequirements,
  validationRequirements: $json.validationRequirements,
  timeline: $json.timeline,
  budget: $json.budget,
  serviceTierAssignment: $json.serviceTierAssignment,
  scoringCriteria: $json.scoringCriteria,
  proposalMustInclude: $json.proposalMustInclude
}, null, 2) }}

Generated proposal:
{{ $json.proposalMarkdown }}`,
        hasOutputParser: true,
        options: {
            systemMessage: 'You review proposal quality only and return JSON only.',
            maxIterations: 3,
        },
    };

    @node({
        id: '6a184461-f070-4ef7-906f-639cfb668e3f',
        name: 'Merge Quality Gate With Proposal',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-8800, 2288],
    })
    MergeQualityGateWithProposal = {
        jsCode: `function parseAiJson(value) {
  let raw = value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.output === "string") raw = raw.output;
    else if (typeof raw.text === "string") raw = raw.text;
    else if (typeof raw.response === "string") raw = raw.response;
    else return raw;
  }

  let clean = String(raw).trim()
    .replace(/^\`\`\`json\\s*/i, "")
    .replace(/^\`\`\`\\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}

const item = $input.all()[0] || { json: {} };
const quality = parseAiJson(item.json);

const proposalItems = $items("Merge Proposal With Lead Data");
const proposalInput = proposalItems?.[0]?.json;

if (!proposalInput) {
  throw new Error("Could not read data from 'Merge Proposal With Lead Data'. Confirm that the merge node executed before this quality gate merge.");
}

return [
  {
    json: {
      ...proposalInput,
      qualityGate: quality,
      approvedToSend: Boolean(quality.approvedToSend)
    }
  }
];`,
    };

    @node({
        id: 'accf5221-a9fe-40fc-bdac-16cd4dbff113',
        name: 'Proposal Approved?',
        type: 'n8n-nodes-base.if',
        version: 2.2,
        position: [-8608, 2000],
    })
    ProposalApproved = {
        conditions: {
            options: {
                caseSensitive: true,
                leftValue: '',
                typeValidation: 'strict',
                version: 2,
            },
            conditions: [
                {
                    id: 'approved-check',
                    leftValue: '={{ $json.approvedToSend }}',
                    operator: {
                        type: 'boolean',
                        operation: 'true',
                    },
                },
            ],
            combinator: 'and',
        },
        options: {},
    };

    @node({
        id: '3af216c8-dcfb-4ab1-bfee-9b7574c74653',
        name: 'HTML Email Formatter',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3.1,
        position: [-8144, 1376],
    })
    HtmlEmailFormatter = {
        promptType: 'define',
        text: `=You are an expert B2B proposal email formatter.

Convert the approved proposal into a well-formatted HTML email.

Return raw valid JSON only.
Do not include Markdown.
Do not wrap the JSON in code fences.
Do not include explanations outside the JSON.
Do not change the substance of the proposal.
Do not remove client-specific details.
Do not add unsupported claims.

Use clean HTML:
- Use h2 for major proposal sections.
- Use p for paragraphs.
- Use ul and li for bullet lists.
- Use tables where the proposal contains matrices or commercial terms.
- Include a professional greeting and closing.

If approvedToSend is false, return:
{
  "readyToSend": false,
  "reason": "Proposal failed quality gate.",
  "requiredRevisions": []
}

If approvedToSend is true, return:
{
  "readyToSend": true,
  "to": null,
  "subject": null,
  "htmlBody": null
}

Subject line format:
Proposal for Intelligent Document Processing Pilot - [companyName]

Input JSON:
{{ JSON.stringify($json, null, 2) }}`,
        hasOutputParser: true,
        options: {
            systemMessage: 'You format approved proposals into HTML email JSON only.',
            maxIterations: 3,
        },
    };

    @node({
        id: '717a8b85-45b7-4021-b8a1-1c002f11392f',
        name: 'Parse HTML Email JSON',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-7696, 1472],
    })
    ParseHtmlEmailJson = {
        jsCode: `function parseAiJson(value) {
  let raw = value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.output === "string") raw = raw.output;
    else if (typeof raw.text === "string") raw = raw.text;
    else if (typeof raw.response === "string") raw = raw.response;
    else return raw;
  }

  let clean = String(raw).trim()
    .replace(/^\`\`\`json\\s*/i, "")
    .replace(/^\`\`\`\\s*/i, "")
    .replace(/\`\`\`$/i, "")
    .trim();

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) clean = clean.slice(first, last + 1);
  return JSON.parse(clean);
}

const item = $input.all()[0] || { json: {} };
const html = parseAiJson(item.json);

const sourceItems = $items("Merge Quality Gate With Proposal");
const source = sourceItems?.[0]?.json;

if (!source) {
  throw new Error("Could not read data from 'Merge Quality Gate With Proposal'. Confirm that the approved branch executed before HTML parsing.");
}

return [
  {
    json: {
      ...source,
      ...html
    }
  }
];`,
    };

    @node({
        id: '81f341a4-3532-479a-8449-d5adc0c32740',
        name: 'Simple Memory',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        version: 1.4,
        position: [-10192, 2176],
    })
    SimpleMemory = {
        sessionIdType: 'customKey',
        sessionKey: '={{ $json.contact.email || "proposal-session" }}',
    };

    @node({
        id: '19c81472-8fc3-433f-b5cb-c487c80a809c',
        name: 'OpenAI Chat Model - Extract',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [-11600, 1824],
        credentials: { openAiApi: { id: 'hmWsCQzSeqoyx0dF', name: 'OpenAi Ea2Sa n8n workflows' } },
    })
    OpenaiChatModelExtract = {
        model: {
            __rl: true,
            value: 'gpt-4o',
            mode: 'list',
            cachedResultName: 'gpt-4o',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: '30fc2cb2-1462-4760-a3c3-27d4d108e327',
        name: 'OpenAI Chat Model - Score',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [-11024, 1824],
        credentials: { openAiApi: { id: 'hmWsCQzSeqoyx0dF', name: 'OpenAi Ea2Sa n8n workflows' } },
    })
    OpenaiChatModelScore = {
        model: {
            __rl: true,
            value: 'gpt-4o',
            mode: 'list',
            cachedResultName: 'gpt-4o',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: '3031a546-6ca9-438f-b0a8-353df5b16e80',
        name: 'OpenAI Chat Model - Proposal',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [-10496, 2160],
        credentials: { openAiApi: { id: 'hmWsCQzSeqoyx0dF', name: 'OpenAi Ea2Sa n8n workflows' } },
    })
    OpenaiChatModelProposal = {
        model: {
            __rl: true,
            value: 'gpt-4o',
            mode: 'list',
            cachedResultName: 'gpt-4o',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: '2f362640-f2f2-4402-bbb7-8320717e53b2',
        name: 'OpenAI Chat Model - Quality',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [-9264, 2768],
        credentials: { openAiApi: { id: 'hmWsCQzSeqoyx0dF', name: 'OpenAi Ea2Sa n8n workflows' } },
    })
    OpenaiChatModelQuality = {
        model: {
            __rl: true,
            value: 'gpt-4o',
            mode: 'list',
            cachedResultName: 'gpt-4o',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: '1e3103ba-529f-41ea-9914-9e8511191acd',
        name: 'OpenAI Chat Model - HTML',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [-8208, 1632],
        credentials: { openAiApi: { id: 'hmWsCQzSeqoyx0dF', name: 'OpenAi Ea2Sa n8n workflows' } },
    })
    OpenaiChatModelHtml = {
        model: {
            __rl: true,
            value: 'gpt-4o',
            mode: 'list',
            cachedResultName: 'gpt-4o',
        },
        responsesApiEnabled: false,
        options: {},
    };

    @node({
        id: 'ad9798ed-11ac-47c4-960c-849395e02129',
        name: 'Prepare Starter Nurture Email',
        type: 'n8n-nodes-base.set',
        version: 3.4,
        position: [-9968, 1488],
    })
    PrepareStarterNurtureEmail = {
        assignments: {
            assignments: [
                {
                    id: '802591a6-f035-438d-899b-9b145bbb0758',
                    name: 'to:',
                    value: '={{ $json.contact.email }}',
                    type: 'string',
                },
                {
                    id: 'd2664d96-c147-48ef-bce9-14ea02bbe160',
                    name: 'Subject:',
                    value: '=subject: A practical next step for organizing {{ $json.companyName }} estimate requests',
                    type: 'string',
                },
                {
                    id: '83a22d73-dfa6-44c4-8262-0fbfb86e90e8',
                    name: 'htmlBody:',
                    value: '=<p>Hi {{ $json.contact.name.split(" ")[0] }},</p>  <p>Thank you for sharing the current workflow at {{ $json.companyName }}.</p>  <p>Based on what you described, your team appears to be in an early exploration stage rather than a full automation project stage. You are handling {{ $json.documentVolume.quantity }} {{ $json.documentVolume.frequency }} across {{ $json.documentVolume.documentTypes.join(", ") }} using {{ $json.currentSystems.join(", ") }}.</p>  <p>At this stage, I would recommend beginning with a small Starter Automation Assessment rather than a full proposal. The purpose would be to identify where a simple workflow could help organize incoming requests, summarize estimate details, flag missing information, and prepare a clean spreadsheet row for staff review.</p>  <p>A good first version would avoid complex integrations and focus on a simple, low-risk workflow:</p>  <ul>   <li>Capture incoming estimate requests from Gmail.</li>   <li>Organize related attachments and photos in Google Drive.</li>   <li>Summarize the request for staff review.</li>   <li>Flag missing customer phone numbers or addresses.</li>   <li>Prepare a draft spreadsheet entry without automatically committing anything to production systems.</li> </ul>  <p>This would give {{ $json.companyName }} a clear view of what automation can do before committing to a larger project.</p>  <p>If helpful, the next step would be a short discovery session to review your current request intake process and identify one small workflow that could be piloted safely.</p>  <p>Best regards,<br> Your Name<br> Enterprise AI Solutions Architect<br> Your Company</p>',
                    type: 'string',
                },
            ],
        },
        options: {},
    };

    @node({
        id: '8c317cde-6c01-4d2f-bbc4-e16a9da612d4',
        webhookId: '5c420ee2-1f5c-4166-86e0-f7f83c0cf2d5',
        name: 'Send a message',
        type: 'n8n-nodes-base.gmail',
        version: 2.2,
        position: [-9536, 1488],
        credentials: { gmailOAuth2: { id: 'DgRaUdQ0yGo37QT9', name: 'ea2sa.architect' } },
    })
    SendAMessage = {
        sendTo: "={{ $('Webhook (Inbound PDF/DOCX)').item.json.body.email }}",
        subject: '={{ $json["Subject:"] }}',
        message: '={{ $json["htmlBody:"] }}',
        options: {},
    };

    @node({
        id: 'b5389348-9294-459f-affc-a30c9b107d33',
        name: 'Simple Memory1',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        version: 1.4,
        position: [-8080, 1792],
    })
    SimpleMemory1 = {};

    @node({
        id: '1af7b920-bc54-40c9-b520-5bc6df1cca9f',
        name: 'Push a message in Pushover',
        type: 'n8n-nodes-base.pushoverTool',
        version: 1,
        position: [-7936, 1648],
        credentials: { pushoverApi: { id: 'z9vyXd9xiQBjIkyd', name: 'Pushover Agentic Alerts' } },
    })
    PushAMessageInPushover = {
        userKey: '<your-pushover-user-key>',
        message: 'Hello G!',
        additionalFields: {},
    };

    @node({
        id: '78b05585-7ef5-4752-997d-39f5cb584a3c',
        name: 'Prepare Report File for Drive',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-7440, 1472],
    })
    PrepareReportFileForDrive = {
        jsCode: `const item = $input.all()[0] || { json: {} };
const j = item.json || {};

let webhookJson = {};
try {
  webhookJson = $("Webhook (Inbound PDF/DOCX)").first().json || {};
} catch (error) {
  webhookJson = {};
}

const workflowId =
  webhookJson.body?.workflowId ||
  j.workflowId ||
  $workflow.id ||
  "professional-services";

const runId =
  $execution.id ||
  \`\${Date.now()}\`;

const companySlug = String(j.companyName || "lead-report")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60) || "lead-report";

const fileName = \`\${companySlug}-\${runId}-proposal.md\`;
const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

const reportMarkdown = j.proposalMarkdown || "";
if (!reportMarkdown.trim()) {
  throw new Error("proposalMarkdown is empty; cannot create Drive report file.");
}

const reportFolderPath = \`ea2sa-reports/\${workflowId}/\${runId}/\`;

// IMPORTANT: Configure the Google Drive upload node to use your target parent folder.
// If you need the exact nested path above created physically in Drive, add folder
// creation/search nodes before upload or use a dedicated sub-workflow.
const reportContent = [
  \`<!--\`,
  \`workflowId: \${workflowId}\`,
  \`runId: \${runId}\`,
  \`expiresAt: \${expiresAt}\`,
  \`companyName: \${j.companyName || ""}\`,
  \`serviceTier: \${j.serviceTierAssignment || ""}\`,
  \`-->\`,
  "",
  reportMarkdown
].join("\\n");

const binaryData = await this.helpers.prepareBinaryData(
  Buffer.from(reportContent, "utf8"),
  fileName,
  "text/markdown"
);

return [
  {
    json: {
      ...j,
      workflowId,
      runId,
      reportFolderPath,
      fileName,
      expiresAt
    },
    binary: {
      data: binaryData
    }
  }
];`,
    };

    @node({
        id: '5abce16a-5bef-4e8e-9800-0284de82b6cd',
        name: 'Google Drive - Upload Report File',
        type: 'n8n-nodes-base.googleDrive',
        version: 3,
        position: [-7216, 1472],
        credentials: { googleDriveOAuth2Api: { id: 'REPLACE_WITH_CREDENTIAL_ID', name: 'Google Drive account' } },
    })
    GoogleDriveUploadReportFile = {
        name: '={{ $json.fileName }}',
        driveId: {
            __rl: true,
            value: '1lcna6LBvxUeNV_m3GvPak0xtWOqsseGk',
            mode: 'id',
        },
        folderId: {
            __rl: true,
            mode: 'id',
            value: '14R2hfT1-H1WfLGrPBGpFk1_0oPqXiwO3',
        },
        options: {},
    };

    @node({
        id: 'b9c7288f-923d-4bc0-8907-f5984781e638',
        name: 'Google Drive - Share Report File',
        type: 'n8n-nodes-base.googleDrive',
        version: 3,
        position: [-6992, 1472],
        credentials: { googleDriveOAuth2Api: { id: 'REPLACE_WITH_CREDENTIAL_ID', name: 'Google Drive account' } },
    })
    GoogleDriveShareReportFile = {
        operation: 'share',
        fileId: {
            __rl: true,
            value: '={{ $json.id }}',
            mode: 'id',
        },
        permissionsUi: {
            permissionsValues: {
                role: 'reader',
                type: 'anyone',
            },
        },
        options: {},
    };

    @node({
        id: '8da22206-5e8f-4157-8bc5-715da4aa8248',
        name: 'Build Drive Response Payload',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [-6768, 1472],
    })
    BuildDriveResponsePayload = {
        jsCode: `const prepared = $items("Prepare Report File for Drive")?.[0]?.json || {};
const uploaded = $items("Google Drive - Upload Report File")?.[0]?.json || {};
const shared = $input.all()?.[0]?.json || {};

const fileId =
  uploaded.id ||
  shared.id ||
  shared.fileId ||
  uploaded.fileId ||
  null;

const driveLink =
  shared.webViewLink ||
  shared.webContentLink ||
  shared.link ||
  uploaded.webViewLink ||
  uploaded.webContentLink ||
  (fileId ? \`https://drive.google.com/file/d/\${fileId}/view?usp=sharing\` : null);

if (!driveLink) {
  throw new Error("Could not determine Drive viewer link from upload/share output.");
}

return [
  {
    json: {
      ...prepared,
      uploadedFile: uploaded,
      shareResult: shared,
      fileId,
      driveLink,
      status: "complete",
      webhookResponse: {
        status: "complete",
        driveLink,
        expiresAt: prepared.expiresAt,
        fileName: prepared.fileName
      }
    }
  }
];`,
    };

    @node({
        id: 'f6216a02-0583-438b-b9b3-52e2624ec1e2',
        name: 'HTTP Response - Report Complete',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.5,
        position: [-6544, 1360],
    })
    HttpResponseReportComplete = {
        respondWith: 'json',
        responseBody: '={{ $json.webhookResponse }}',
        options: {},
    };

    @node({
        id: '7cd64612-9990-49ea-a879-2cb69e36d1de',
        webhookId: '63ca7945-5207-4afa-afd3-7d0423ac1f25',
        name: 'Send Report Ready Notification',
        type: 'n8n-nodes-base.gmail',
        version: 2.2,
        position: [-6544, 1584],
        credentials: { gmailOAuth2: { id: 'DgRaUdQ0yGo37QT9', name: 'ea2sa.architect' } },
    })
    SendReportReadyNotification = {
        sendTo: "={{ $('Webhook (Inbound PDF/DOCX)').item.json.body.email || $json.contact?.email }}",
        subject: "=Your report is ready - {{ $json.companyName || 'Ea2Sa' }}",
        message:
            '=<p>Your report is ready.</p><p><a href="{{ $json.driveLink }}">Open your report</a></p><p>This link is intended to expire at {{ $json.expiresAt }}.</p>',
        options: {
            ccList: 'gary@ea2sa.org',
        },
    };

    @node({
        id: '48bf467e-4589-4886-be0b-71a450545ec1',
        name: 'HTTP Response - Starter Nurture Complete',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.5,
        position: [-9120, 1488],
    })
    HttpResponseStarterNurtureComplete = {
        respondWith: 'json',
        responseBody:
            '={{ { status: "complete", driveLink: null, expiresAt: null, fileName: null, message: "Lead did not meet proposal threshold; starter nurture email sent." } }}',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.WebhookInboundPdfDocx.out(0).to(this.ExtractPdfText.in(0));
        this.ExtractPdfText.out(0).to(this.NormalizeExtractedText.in(0));
        this.NormalizeExtractedText.out(0).to(this.AiLeadExtractor.in(0));
        this.AiLeadExtractor.out(0).to(this.ParseExtractedLeadJson.in(0));
        this.ParseExtractedLeadJson.out(0).to(this.AiLeadScorer.in(0));
        this.AiLeadScorer.out(0).to(this.ParseScoredLeadJson.in(0));
        this.ParseScoredLeadJson.out(0).to(this.Score70.in(0));
        this.Score70.out(0).to(this.CreateOrUpdateAContact.in(0));
        this.Score70.out(0).to(this.HubspotCrmCreateUpdate.in(0));
        this.Score70.out(0).to(this.ProposalDraftGenerator.in(0));
        this.Score70.out(1).to(this.PrepareStarterNurtureEmail.in(0));
        this.ProposalDraftGenerator.out(0).to(this.NormalizeProposalDraft.in(0));
        this.NormalizeProposalDraft.out(0).to(this.MergeProposalWithLeadData.in(0));
        this.MergeProposalWithLeadData.out(0).to(this.ProposalQualityGate.in(0));
        this.ProposalQualityGate.out(0).to(this.MergeQualityGateWithProposal.in(0));
        this.MergeQualityGateWithProposal.out(0).to(this.ProposalApproved.in(0));
        this.ProposalApproved.out(0).to(this.HtmlEmailFormatter.in(0));
        this.HtmlEmailFormatter.out(0).to(this.ParseHtmlEmailJson.in(0));
        this.ParseHtmlEmailJson.out(0).to(this.PrepareReportFileForDrive.in(0));
        this.PrepareStarterNurtureEmail.out(0).to(this.SendAMessage.in(0));
        this.PrepareReportFileForDrive.out(0).to(this.GoogleDriveUploadReportFile.in(0));
        this.GoogleDriveUploadReportFile.out(0).to(this.GoogleDriveShareReportFile.in(0));
        this.GoogleDriveShareReportFile.out(0).to(this.BuildDriveResponsePayload.in(0));
        this.BuildDriveResponsePayload.out(0).to(this.HttpResponseReportComplete.in(0));
        this.BuildDriveResponsePayload.out(0).to(this.SendReportReadyNotification.in(0));
        this.SendAMessage.out(0).to(this.HttpResponseStarterNurtureComplete.in(0));

        this.AiLeadExtractor.uses({
            ai_languageModel: this.OpenaiChatModelExtract.output,
        });
        this.AiLeadScorer.uses({
            ai_languageModel: this.OpenaiChatModelScore.output,
        });
        this.ProposalDraftGenerator.uses({
            ai_languageModel: this.OpenaiChatModelProposal.output,
            ai_memory: this.SimpleMemory.output,
        });
        this.ProposalQualityGate.uses({
            ai_languageModel: this.OpenaiChatModelQuality.output,
        });
        this.HtmlEmailFormatter.uses({
            ai_languageModel: this.OpenaiChatModelHtml.output,
            ai_tool: [this.PushAMessageInPushover.output],
        });
    }
}
