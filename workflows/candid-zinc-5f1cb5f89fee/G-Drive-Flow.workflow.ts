import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : G-Drive-Flow
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// GoogleDriveTrigger                 googleDriveTrigger         [creds]
// DownloadFile                       googleDrive                [creds]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// GoogleDriveTrigger
//    → DownloadFile
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: "Flclh6_-cD7TkKSHgsQSD",
    name: "G-Drive-Flow",
    active: false,
    isArchived: false,
    projectId: "Ty510WNb6tNHkgmk",
    projectName: "Gary Shepard <gary@ea2sa.org>",
    homeProject: {"id":"Ty510WNb6tNHkgmk","name":"Gary Shepard <gary@ea2sa.org>","type":"personal","createdAt":"2025-11-21T17:06:03.227Z","updatedAt":"2025-11-21T17:06:08.305Z"},
    tags: ["pii","customer-data"],
    settings: { executionOrder: "v1", availableInMCP: false, binaryMode: "separate" }
})
export class GDriveFlowWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "b9a287df-64fd-475b-ac73-34bc69988d0b",
        name: "Google Drive Trigger",
        type: "n8n-nodes-base.googleDriveTrigger",
        version: 1,
        position: [-1312, -400],
        credentials: {googleDriveOAuth2Api:{id:"REPLACE_WITH_CREDENTIAL_ID",name:"Google Drive account"}}
    })
    GoogleDriveTrigger = {
        pollTimes: {
            item: [
                {
                    mode: "custom",
                    cronExpression: "=* * * * * *"
                }
            ]
        },
        triggerOn: "specificFolder",
        folderToWatch: {
            __rl: true,
            value: "1FBqWYQMTH0soUQrXmR8ATJABT44_ZjGc",
            mode: "list",
            cachedResultName: "n8n-folder",
            cachedResultUrl: "https://drive.google.com/drive/folders/1FBqWYQMTH0soUQrXmR8ATJABT44_ZjGc"
        },
        event: "fileUpdated",
        options: {}
    };

    @node({
        id: "3ac8cbc7-6064-4f9e-8a8b-65edb619c41a",
        name: "Download file",
        type: "n8n-nodes-base.googleDrive",
        version: 3,
        position: [-944, -400],
        credentials: {googleDriveOAuth2Api:{id:"REPLACE_WITH_CREDENTIAL_ID",name:"Google Drive account"}}
    })
    DownloadFile = {
        operation: "download",
        fileId: {
            __rl: true,
            value: "={{ $json.id }}",
            mode: "id"
        },
        options: {}
    };


    // =====================================================================
// ROUTAGE ET CONNEXIONS
// =====================================================================

    @links()
    defineRouting() {
        this.GoogleDriveTrigger.out(0).to(this.DownloadFile.in(0));
    }
}