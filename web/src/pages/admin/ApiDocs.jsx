export function ApiDocs() {
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
      <p className="text-sm text-gray-500 mb-3">
        Live OpenAPI documentation for all IOA Governance Platform services.
        Use the explorer dropdown to switch between services.
      </p>
      <iframe
        src="/api/api-docs"
        className="flex-1 w-full border border-gray-200 rounded"
        title="IOA API Documentation"
      />
    </div>
  )
}
