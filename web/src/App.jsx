import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, AuthGuard, AdminGuard, PermissionGuard } from './components/AuthGuard'
import { Login } from './pages/Login'
import { Layout } from './components/Layout'
import { AdminLayout } from './components/AdminLayout'
import { Dashboard } from './pages/Dashboard'
import { Governance } from './pages/Governance'
import { Violations } from './pages/governance/Violations'
import { Enforcement } from './pages/governance/Enforcement'
import { McpRegistry } from './pages/governance/McpRegistry'
import { AiInference } from './pages/AiInference'
import { WorkflowGovernance } from './pages/WorkflowGovernance'
import { Assurance } from './pages/Assurance'
import { Lineage } from './pages/Lineage'
import { AnomalyDetection } from './pages/AnomalyDetection'
import { RoiIntelligence } from './pages/RoiIntelligence'
import { Audit } from './pages/Audit'
import { Escalation } from './pages/Escalation'
import { Telemetry } from './pages/Telemetry'
import { TagAdmin } from './pages/admin/TagAdmin'
import { UserManagement } from './pages/admin/UserManagement'
import { Integrations } from './pages/admin/Integrations'
import { WaiverAdmin } from './pages/admin/WaiverAdmin'
import { ApprovalChains } from './pages/admin/ApprovalChains'
import { ApiDocs } from './pages/admin/ApiDocs'
import { ControlTests } from './pages/admin/ControlTests'
import { PromptRegistry } from './pages/admin/PromptRegistry'
import { BudgetAdmin } from './pages/admin/BudgetAdmin'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<AuthGuard><Layout /></AuthGuard>}>
              <Route index element={<Dashboard />} />
              <Route path="governance"  element={<Governance />} />
              <Route path="violations" element={<Violations />} />
              <Route path="enforcement" element={<Enforcement />} />
              <Route path="mcp-registry" element={<McpRegistry />} />
              <Route path="inference"   element={<AiInference />} />
              <Route path="workflows"   element={<WorkflowGovernance />} />
              <Route path="assurance"  element={<Assurance />} />
              <Route path="lineage"    element={<Lineage />} />
              <Route path="anomaly"   element={<AnomalyDetection />} />
              <Route path="roi"         element={<RoiIntelligence />} />
              <Route path="audit"       element={<Audit />} />
              <Route path="escalation"  element={<Escalation />} />
              <Route path="telemetry"   element={<Telemetry />} />

              {/* Administration section — add new admin pages as children here */}
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="tags" replace />} />
                <Route path="tags"         element={<TagAdmin />} />
                <Route path="waivers"      element={<WaiverAdmin />} />
                <Route path="approval-chains" element={<ApprovalChains />} />
                <Route path="integrations" element={<Integrations />} />
                <Route path="users"            element={<PermissionGuard permission="user:manage"><UserManagement /></PermissionGuard>} />
                <Route path="budgets"          element={<AdminGuard><BudgetAdmin /></AdminGuard>} />
                <Route path="control-tests"    element={<AdminGuard><ControlTests /></AdminGuard>} />
                <Route path="prompt-registry" element={<AdminGuard><PromptRegistry /></AdminGuard>} />
                <Route path="api-docs"        element={<AdminGuard><ApiDocs /></AdminGuard>} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
