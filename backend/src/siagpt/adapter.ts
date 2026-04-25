import { type Express } from 'express'
import { config } from '../config.js'

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'SIA Strategy Assessment Agent API',
    version: '1.0.0',
    description: 'AI-powered 8-pillar organizational strategy assessment platform by SIA Partners',
    contact: { name: 'SIA Partners', url: 'https://www.sia-partners.com' },
  },
  servers: [{ url: '/api', description: 'Current server' }],
  paths: {
    '/projects': {
      get: { summary: 'List all projects', tags: ['Projects'], responses: { '200': { description: 'Array of project summaries' } } },
      post: { summary: 'Create a new assessment project', tags: ['Projects'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, entityName: { type: 'string' }, entityType: { type: 'string' }, password: { type: 'string' } } } } } }, responses: { '201': { description: 'Created project' } } },
    },
    '/projects/{id}': {
      get: { summary: 'Get project by ID', tags: ['Projects'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Full project object' } } },
      put: { summary: 'Save entire project', tags: ['Projects'], responses: { '200': { description: 'Saved project' } } },
      delete: { summary: 'Delete project', tags: ['Projects'], responses: { '200': { description: 'Deleted' } } },
    },
    '/projects/{id}/unlock': {
      post: { summary: 'Authenticate project access', tags: ['Auth'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string' } } } } } }, responses: { '200': { description: 'Authenticated' }, '401': { description: 'Wrong password' } } },
    },
    '/documents/{projectId}/upload': {
      post: { summary: 'Upload documents for analysis', tags: ['Documents'], requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } }, docType: { type: 'string' } } } } } }, responses: { '200': { description: 'Uploaded documents with extracted text' } } },
    },
    '/ai/{projectId}/assess/{pillarId}': {
      post: { summary: 'Run AI assessment for a pillar (SSE stream)', tags: ['AI'], parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'pillarId', in: 'path', required: true, schema: { type: 'string', enum: ['P1','P2','P3','P4','P5','P6','P7','P8'] } }], responses: { '200': { description: 'Server-sent events stream of assessment progress and result' } } },
    },
    '/ai/{projectId}/chat': {
      post: { summary: 'AI consultant chat (SSE stream)', tags: ['AI'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array' }, context: { type: 'object' } } } } } }, responses: { '200': { description: 'Server-sent events stream of chat response' } } },
    },
    '/ai/{projectId}/consolidate-swot': {
      post: { summary: 'Generate consolidated SWOT analysis', tags: ['AI'], responses: { '200': { description: 'SWOT analysis object' } } },
    },
    '/ai/{projectId}/generate-report/{reportType}': {
      post: { summary: 'Generate a deliverable report', tags: ['AI'], parameters: [{ name: 'reportType', in: 'path', required: true, schema: { type: 'string', enum: ['D1','D2','D3','D4','D5','D6'] } }], responses: { '200': { description: 'Report content as markdown string' } } },
    },
    '/export/{projectId}/pdf/{reportType}': {
      post: { summary: 'Download report as branded PDF', tags: ['Export'], responses: { '200': { description: 'PDF file', content: { 'application/pdf': {} } } } },
    },
    '/export/{projectId}/pptx/{reportType}': {
      post: { summary: 'Download report as PPTX presentation', tags: ['Export'], responses: { '200': { description: 'PPTX file' } } },
    },
  },
  components: {
    securitySchemes: {
      sessionAuth: { type: 'apiKey', in: 'cookie', name: 'connect.sid', description: 'Express session cookie' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'SIA SSO JWT token (see /middleware/ssoAuth.ts)' },
    },
  },
  security: [{ sessionAuth: [] }, { bearerAuth: [] }],
}

const PLUGIN_MANIFEST = {
  schema_version: 'v1',
  name_for_human: 'SIA Strategy Assessment',
  name_for_model: 'sia_strategy_assessment',
  description_for_human: '8-pillar organizational strategy assessment tool by SIA Partners',
  description_for_model: 'Assess organizations using the SIA Partners 8-pillar framework. Upload documents, run AI-powered assessments, generate SWOT analyses, strategy trees, and D1-D6 consulting reports.',
  auth: { type: 'oauth' },
  api: { type: 'openapi', url: `${config.frontendUrl}/openapi.json` },
  logo_url: `${config.frontendUrl}/sia-logo.png`,
  contact_email: 'tech@sia-partners.com',
  legal_info_url: 'https://www.sia-partners.com',
}

export function registerSiaGptRoutes(app: Express) {
  app.get('/openapi.json', (_req, res) => {
    res.json(OPENAPI_SPEC)
  })

  app.get('/.well-known/ai-plugin.json', (_req, res) => {
    res.json(PLUGIN_MANIFEST)
  })
}
