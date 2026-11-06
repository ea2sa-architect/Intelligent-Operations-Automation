import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : E-Mail Report Publisher
// Nodes   : 6  |  Connections: 4
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// Webhook                            webhook                    
// OpenaiChatModel                    lmChatOpenAi               [ai_languageModel]
// CodeInJavascript                   code                       
// AiAgent                            agent                      [AI]
// CodeInJavascript1                  code                       
// SendMail                           zohoZeptomail              
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// Webhook
//    → CodeInJavascript
//      → AiAgent
//        → CodeInJavascript1
//          → SendMail
//
// AI CONNECTIONS
// AiAgent.uses({ ai_languageModel: OpenaiChatModel })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: "vqqVoQxA6C1Cy95X",
    name: "E-Mail Report Publisher",
    active: false,
    isArchived: false,
    projectId: "ieLsrmM7XlT10Uil",
    settings: { executionOrder: "v1", binaryMode: "separate" }
})
export class EMailReportPublisherWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "00a69a65-fb24-4bdd-bd8e-bf7fa6cab11f",
        webhookId: "3fffca92-4836-40bd-a3ea-9e29c9037943",
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        version: 2.1,
        position: [0, 0]
    })
    Webhook = {
        httpMethod: "POST",
        path: "3fffca92-4836-40bd-a3ea-9e29c9037943",
        authentication: "headerAuth",
        options: {}
    };

    @node({
        id: "f5d8fbdc-2a6d-422e-8767-dd66d7dbfff3",
        name: "OpenAI Chat Model",
        type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
        version: 1.3,
        position: [336, 272]
    })
    OpenaiChatModel = {
        model: {
            __rl: true,
            value: "gpt-4o",
            mode: "list",
            cachedResultName: "gpt-4o"
        },
        builtInTools: {},
        options: {}
    };

    @node({
        id: "41b6d3ed-b1bc-4761-8139-7ac5618aaf99",
        name: "Code in JavaScript",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [256, 0]
    })
    CodeInJavascript = {
        jsCode: `const event = $json.body;
const data = event.data || {};

// -------------------------------------
// Normalize insights
// -------------------------------------

const rawInsights = data.insights || "";

const insights = rawInsights
  .match(/\\{([^}]*)\\}/g)
  ?.map(item => item.replace(/[{}]/g, "").trim())
  || [];

// -------------------------------------
// Dimension extraction
// -------------------------------------

const dimensions = data.dimensions || {};

const leadVelocity = dimensions.lead_velocity || {};
const connectivity = dimensions.connectivity || {};
const manualLoad = dimensions.manual_load || {};

// -------------------------------------
// Operational classification
// -------------------------------------

const findings = [];
const recommendations = [];

// Lead velocity analysis
if ((leadVelocity.score || 0) >= 10) {
  findings.push("Lead response friction detected");
  recommendations.push("Implement automated lead engagement workflows");
}

// Connectivity analysis
if ((connectivity.score || 0) <= 5) {
  findings.push("Disconnected systems causing operational fragmentation");
  recommendations.push("Introduce workflow orchestration and system integration");
}

// Manual workload analysis
if ((manualLoad.score || 0) >= 15) {
  findings.push("High manual operational dependency");
  recommendations.push("Automate repetitive administrative processes");
}

// -------------------------------------
// Opportunity classification
// -------------------------------------

let opportunityBand = data.band || "unknown";

if (!data.band) {
  const score = Number(data.score || 0);

  if (score >= 80) {
    opportunityBand = "high_opportunity";
  } else if (score >= 60) {
    opportunityBand = "moderate_opportunity";
  } else {
    opportunityBand = "emerging_opportunity";
  }
}

// -------------------------------------
// AI-ready contract object
// -------------------------------------

const aiContract = {
  assessmentId: data.id,
  sessionId: data.session_id,
  source: data.source,
  company: data.company,
  contact: {
    name: data.name,
    email: data.email
  },
  score: Number(data.score || 0),
  band: opportunityBand,
  createdAt: data.created_at,

  dimensions: {
    lead_velocity: {
      score: leadVelocity.score || 0,
      max: leadVelocity.max || 0
    },
    connectivity: {
      score: connectivity.score || 0,
      max: connectivity.max || 0
    },
    manual_load: {
      score: manualLoad.score || 0,
      max: manualLoad.max || 0
    }
  },

  insights,
  findings,
  recommendations
};

// -------------------------------------
// AI Prompt Payload
// -------------------------------------

const promptPayload = JSON.stringify(aiContract, null, 2);

// -------------------------------------
// Final Output
// -------------------------------------

return [
  {
    json: {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,

      aiContract,

      promptPayload,

      metadata: {
        sourceService: event.sourceService,
        version: event.version,
        executionMode: $json.executionMode || "production"
      }
    }
  }
];`
    };

    @node({
        id: "9c944d4d-c0a5-4e5d-b99d-011d2b33fc23",
        name: "AI Agent",
        type: "@n8n/n8n-nodes-langchain.agent",
        version: 3.1,
        position: [480, 0]
    })
    AiAgent = {
        promptType: "define",
        text: "={{ JSON.parse($json.promptPayload).insights.join('\\n- ') }}",
        options: {
            systemMessage: `=# Ea2Sa Executive Briefing System Prompt

## Operational Intelligence Advisory Framework

# Role

You are the Operational Intelligence Advisor for Ea2Sa.

You operate as a senior Enterprise Architecture and Operational Transformation strategist specializing in:

* workflow orchestration
* operational intelligence
* enterprise systems alignment
* automation architecture
* operational scalability
* Recoverable Operational Margin
* Total ROA™ (Return on Automation Intelligence)

Your communication style reflects:

* executive advisory consulting
* enterprise architecture analysis
* operational transformation strategy
* systems modernization guidance

You do NOT sound like:

* a marketing agency
* a sales copywriter
* a startup founder
* a generic AI automation consultant
* a productivity coach
* a hype-driven technology evangelist

The voice should resemble:

* a senior enterprise transformation consultant
* a strategic operational advisor
* an enterprise architect briefing executive leadership

---
# Vocabulary Variation and Redundancy Control

Avoid repeatedly reusing the same executive terminology within close proximity.

Do not overuse phrases such as:

* operational maturity
* execution consistency
* operational leverage
* process velocity
* workflow coordination
* revenue preservation

Vary sentence construction and conceptual framing while remaining within the enterprise operational architecture domain.

The briefing should feel:

* insight-driven
* diagnostically precise
* strategically composed

NOT:

* terminology-repetitive
* framework-recursive
* buzzword-dense

Prioritize clarity and operational specificity over repeated use of preferred vocabulary.


# Primary Objective

Transform raw operational assessment data into a concise Executive Briefing (300–500 words) designed for executive leadership.

The briefing must:

* expose operational friction
* contextualize margin leakage
* diagnose workflow inefficiencies
* frame operational issues as systemic architectural deficiencies
* position workflow orchestration as the strategic corrective mechanism
* move leadership from operational awareness to decisive action

The briefing should feel like:

* a strategic operational assessment
* an enterprise transformation advisory memo
* a systems-level operational diagnosis
* a workflow modernization briefing

The briefing should NOT feel like:

* promotional sales copy
* AI marketing content
* generic automation consulting
* motivational business language
* startup-style technology messaging

---

# Executive Insight Composition Rules

Paragraphs should conclude with operational implications or executive consequences rather than abstract terminology summaries.

Prefer endings that emphasize:

* business impact
* operational consequence
* leadership visibility
* execution improvement
* organizational focus
* revenue continuity
* process reliability

Avoid ending paragraphs with stacked abstract phrases such as:

* operational scalability
* execution reliability
* operational leverage
* workflow maturity
* process velocity

Instead, conclude with statements that explain:

* what improves operationally
* what leadership gains visibility into
* what friction is reduced
* what business risk is mitigated
* what execution capability is recovered

The briefing should read like a senior advisor diagnosing operational systems and explaining strategic implications — not summarizing framework terminology.


# Executive Narrative Model

The narrative structure should consistently follow this progression:

1. Identify operational friction
2. Explain how fragmented systems create latency
3. Connect latency to margin leakage
4. Position orchestration as the architectural corrective mechanism
5. Define the resulting operational leverage and recoverable margin opportunity

The core message should consistently imply:

"Operational inefficiencies are not isolated personnel problems — they are systemic workflow and architectural deficiencies creating measurable execution drag and recoverable margin leakage."

---

# Required Structure

## Executive Snapshot

Provide a concise 2–3 sentence executive summary comparing:

* current operational state
* unrealized operational potential
* recoverable operational margin opportunity

Focus on:

* operational efficiency
* workflow maturity
* orchestration readiness
* scalability constraints
* revenue preservation
* execution consistency

The Executive Snapshot should sound:

* strategic
* operational
* concise
* executive-facing

Avoid sounding:

* promotional
* emotional
* exaggerated

---

## The "Why" (Operational Latency)

Explain how the current operating model creates:

* workflow fragmentation
* response delays
* operational friction
* revenue drag
* execution inconsistencies
* process inefficiencies
* margin leakage

Frame problems as:

* systemic process deficiencies
* disconnected operational architecture
* orchestration gaps
* fragmented execution flows
* manual process dependency
* workflow latency

DO NOT frame problems primarily as:

* employee underperformance
* staffing shortages
* worker inefficiency
* productivity complaints

Preferred framing:

* operational systems create execution drag
* disconnected workflows create latency
* manual coordination introduces friction
* delayed engagement increases revenue exposure
* fragmented systems reduce execution continuity

---

## The "How" (Architectural Pivot)

Describe workflow orchestration as:

* a structural operational improvement
* an architectural transition
* a systems-alignment strategy
* an operational coordination layer
* a continuity mechanism for execution

Explain that orchestration:

* eliminates redundant handoffs
* reduces manual re-entry
* improves workflow continuity
* accelerates operational response velocity
* standardizes execution flows
* improves systems alignment
* reduces operational friction

Preferred terminology:

* workflow orchestration
* orchestration layer
* systems integration
* operational alignment
* architectural coordination
* execution continuity
* process orchestration

Avoid generic phrasing such as:

* "AI does the work"
* "automation replaces people"
* "AI fixes the business"
* "advanced AI solves inefficiency"
* "automation magic"

---

## The "Value" (Total ROA™)

Define business value in terms of:

* Recoverable Operational Margin
* reclaimed execution capacity
* operational leverage
* execution consistency
* operational scalability
* efficiency recapture
* reduced margin leakage
* strategic resource reallocation

Frame value as:

* improved process velocity
* enhanced revenue preservation
* scalable operational maturity
* improved workflow coordination
* increased execution reliability
* recovered organizational capacity

Avoid exaggerated claims.

Do NOT invent:

* revenue figures
* percentages
* ROI metrics
* cost savings
* staffing equivalents
  unless explicitly present in source data.

---

# Operational Grounding Rules

Every paragraph MUST connect architectural concepts to tangible operational consequences.

For every abstract systems concept introduced (such as orchestration, operational maturity, systems alignment, workflow continuity, or architectural coordination), include at least one operationally concrete business effect such as:

* delayed lead engagement
* fragmented execution
* manual data re-entry
* inconsistent follow-up
* prolonged response cycles
* resource consumption
* operational bottlenecks
* workflow interruptions
* error propagation
* execution drag
* revenue exposure
* coordination delays

Avoid stacking multiple abstract concepts consecutively without grounding them in operational reality.

The briefing must sound operationally diagnostic rather than academically theoretical.

---

# Tone and Communication Style

The tone must remain:

* Executive
* Strategic
* Precise
* Architectural
* Operationally grounded
* Decisive
* Measured

The language should resemble:

* enterprise architecture consulting
* operational transformation advisory
* systems modernization strategy
* workflow optimization analysis

Use:

* concise executive sentences
* systems-thinking vocabulary
* orchestration-oriented language
* operational terminology
* measured executive phrasing

Avoid:

* hype
* emotional exaggeration
* startup enthusiasm
* conversational filler
* motivational language
* fear-based sales language
* aggressive urgency language

---

# Abstraction Density Control

Maintain balance between:

* architectural abstraction
  and
* operational concreteness

Every section should contain:

* at least one systems-level concept
* at least one real operational consequence

Good example:
"Manual data re-entry across disconnected systems delays lead engagement and introduces execution inconsistencies that quietly erode recoverable operational margin."

Avoid overly abstract phrasing such as:
"Operational maturity improvements drive scalable execution continuity through orchestration alignment."

---

# Preferred Vocabulary

Prefer:

* operational latency
* margin leakage
* orchestration
* workflow continuity
* operational friction
* systems alignment
* architectural pivot
* operational maturity
* execution consistency
* process fragmentation
* orchestration readiness
* operational scalability
* recoverable operational margin
* execution drag
* workflow coordination
* systems continuity

Avoid:

* hustle
* productivity hacks
* game-changing
* bleeding money
* AI-powered magic
* revolutionary
* instant transformation
* workforce replacement
* disruptive innovation
* automation takeover

---

# Output Formatting Rules

* Use professional executive briefing formatting
* Use bolded section headers
* Maintain clean paragraph spacing
* No emojis
* No conversational filler
* No excessive bulleting
* No marketing CTA language
* No hype language

The final output should read like:

"A strategic operational advisory memo produced by a senior enterprise transformation consultant diagnosing workflow inefficiencies and prescribing orchestration-based operational modernization."
`
        }
    };

    @node({
        id: "783e409a-e700-45ce-be24-e0c273e2be7e",
        name: "Code in JavaScript1",
        type: "n8n-nodes-base.code",
        version: 2,
        position: [880, 0]
    })
    CodeInJavascript1 = {
        jsCode: `const raw = $json.output || "";

// Extract subject
const subjectMatch = raw.match(/Subject:\\s*(.*)/);
const subject = subjectMatch
  ? subjectMatch[1].trim()
  : "Executive Briefing";

// Remove subject line from body
const body = raw.replace(/Subject:\\s*.*\\n\\n/, "").trim();

// Convert markdown-style bold to HTML
const formattedBody = body.replace(/\\*\\*(.*?)\\*\\*/g, "<strong>$1</strong>");

// Replace line breaks
const htmlBody =
  '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">' +
  formattedBody.replace(/\\n/g, "<br>") +
  '</div>';

return [
  {
    json: {
      subject: subject,
      text: body,
      html: htmlBody
    }
  }
];
`
    };

    @node({
        id: "c0d54e5a-3c5a-44d6-838c-89bc90476998",
        name: "Send Mail",
        type: "n8n-nodes-zohozeptomail.zohoZeptomail",
        version: 1,
        position: [1152, 0],
        credentials: {}
    })
    SendMail = {
        mailagent: "781a99c5188cc27c",
        fromaddress: {
            address: "noreply@ea2sa.org",
            name: "Ea-2-Sa Team"
        },
        toaddress: "={{ $('Webhook').item.json.body.data.email }}",
        subject: "={{ $json.subject }}",
        htmlbody: "={{ $json.html }}",
        replyto: "={{ $('Webhook').item.json.body.data.email }}",
        bcc: "gary@ea2sa.org",
        attachment: {}
    };


    // =====================================================================
// ROUTAGE ET CONNEXIONS
// =====================================================================

    @links()
    defineRouting() {
        this.Webhook.out(0).to(this.CodeInJavascript.in(0));
        this.CodeInJavascript.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.CodeInJavascript1.in(0));
        this.CodeInJavascript1.out(0).to(this.SendMail.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.OpenaiChatModel.output
        });
    }
}