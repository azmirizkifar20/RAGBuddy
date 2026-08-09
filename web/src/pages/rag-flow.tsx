import { PageHeader } from '@/components/layout/page-header'
import { FlowDiagram, type FlowStage } from '@/components/flow-diagram'

const INDEXING: FlowStage[] = [
  {
    id: 'source',
    title: 'Sources',
    caption: 'repo + uploads',
    detail:
      'Two inputs feed the same pipeline: the Markdown files inside a registered repository’s configured paths, and documents you upload through the dashboard — PDF, Word, Excel, Markdown, CSV or plain text. Uploads are stored by RAGBuddy, never written into your repository.',
    source: 'src/ingestion/scanner.ts · src/ingestion/uploads.ts',
  },
  {
    id: 'extract',
    title: 'Extract',
    caption: 'binary → text',
    detail:
      'Uploaded PDFs, Word files and spreadsheets are converted to Markdown-shaped text: a PDF gets one heading per page, a Word file keeps its own headings, a workbook gets one heading per sheet. Embedded images are dropped — two photos in a real Word file expanded into 8.5MB of base64 that means nothing to an embedding model. Repository Markdown skips this step entirely.',
    source: 'src/ingestion/document-extractor.ts',
  },
  {
    id: 'scan',
    title: 'Scan & hash',
    caption: 'what changed?',
    detail:
      'Only .md, .mdx and .txt inside the paths you registered are scanned — node_modules, .git, .env, CLAUDE.md and friends are skipped outright. Each file gets a content hash so a sync can tell added from modified from untouched.',
    source: 'src/ingestion/scanner.ts · src/ingestion/hasher.ts',
  },
  {
    id: 'chunk',
    title: 'Chunk',
    caption: 'split by heading',
    detail:
      'Documents are split along Markdown headings first, so a chunk is a coherent section rather than an arbitrary slice. Oversized sections are then split with overlap so no sentence falls between two chunks.',
    source: 'src/ingestion/parser.ts · src/ingestion/chunker.ts',
  },
  {
    id: 'embed',
    title: 'Embed',
    caption: 'text → vector',
    detail:
      'Each chunk is sent to your embedding provider (Ollama or any OpenAI-compatible endpoint) and comes back as a vector. The document title and section heading are prepended to the text so the vector carries that context too.',
    source: 'src/embedding/embedding-provider.ts',
  },
  {
    id: 'store',
    title: 'Store',
    caption: 'Qdrant',
    detail:
      'Vectors land in one Qdrant collection, every point tagged with its project id, file path, content hash, git commit and source. Qdrant is only a cache — the whole index is rebuildable from Git at any time.',
    source: 'src/qdrant/qdrant-repository.ts',
  },
]

const RETRIEVAL: FlowStage[] = [
  {
    id: 'ask',
    title: 'Agent asks',
    caption: 'in your repo',
    detail:
      'Claude Code, OpenCode or Codex calls search_project_docs while working inside your repository. The project is resolved from the agent’s working directory, so it never has to be told which project it is in.',
    source: 'src/projects/project-resolver.ts',
  },
  {
    id: 'mcp',
    title: 'MCP server',
    caption: 'one per agent',
    detail:
      'A single stdio MCP server exposes four tools to every agent: get_project_context, search_project_docs, get_project_document and list_project_knowledge. Same server, same behaviour, whichever agent connects.',
    source: 'src/mcp/server.ts',
  },
  {
    id: 'embed-query',
    title: 'Embed query',
    caption: 'same model',
    detail:
      'The question goes through the exact same embedding model the documents did — that is what makes the distances comparable. Change the model and you must re-ingest everything.',
    source: 'src/retrieval/search.ts',
  },
  {
    id: 'filter',
    title: 'Project filter',
    caption: 'hard isolation',
    detail:
      'The vector search always carries a project filter enforced at the Qdrant query layer, not by prompting. Project A can never surface Project B’s documents, even if the agent asks for it.',
    source: 'src/qdrant/qdrant-repository.ts',
  },
  {
    id: 'answer',
    title: 'Top-K chunks',
    caption: 'back to the agent',
    detail:
      'The closest chunks come back with their file path, section heading and similarity score. The agent reads them as context — and can call get_project_document to pull a full file when a snippet is not enough.',
    source: 'src/mcp/tools/search-project-docs.ts',
  },
]

const AUTOSYNC: FlowStage[] = [
  {
    id: 'commit',
    title: 'git commit',
    caption: 'you write docs',
    detail:
      'You commit as usual. Nothing about your workflow changes — the hook runs after the commit is already recorded.',
  },
  {
    id: 'hook',
    title: 'post-commit hook',
    caption: 'fires automatically',
    detail:
      'RAGBuddy installs a marker-delimited block into .git/hooks/post-commit, coexisting with any hook already there. If the sync fails, it prints a warning — your commit is never blocked or rolled back.',
    source: 'src/git/hook-installer.ts',
  },
  {
    id: 'diff',
    title: 'Diff by hash',
    caption: 'added/modified/deleted',
    detail:
      'The sync compares content hashes in Qdrant against the files on disk. Unchanged files are skipped entirely — no embedding call, no cost. Only what actually changed gets re-embedded.',
    source: 'src/ingestion/sync.ts',
  },
  {
    id: 'fresh',
    title: 'Index is fresh',
    caption: 'agents see it now',
    detail:
      'By the time you switch back to your agent, its knowledge base already reflects the commit you just made. Uploaded documents are left untouched by the diff — they have no counterpart on disk to compare against.',
  },
]

export function RagFlow() {
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="How this RAG works"
        description="Three flows: how documents get indexed, how an agent retrieves them, and how it all stays fresh."
      />

      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        RAGBuddy turns each registered Git repository's documentation into a private, project-scoped knowledge base
        that coding agents query over MCP — instead of re-reading the same files into their context every session. Click
        any step below to see what it does and where it lives in the code.
      </p>

      <div className="flex flex-col gap-4">
        <FlowDiagram
          title="1 · Indexing pipeline"
          description="Runs on a full ingest, an incremental sync, or a document upload."
          stages={INDEXING}
        />
        <FlowDiagram
          title="2 · Retrieval pipeline"
          description="What happens when an agent asks a question — the read path."
          stages={RETRIEVAL}
        />
        <FlowDiagram
          title="3 · Auto-sync loop"
          description="How the index stays current without you thinking about it."
          stages={AUTOSYNC}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Isolation is structural, not prompted</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every retrieval and every document read is filtered by project id and validated against path traversal at
            the storage layer. There is no prompt an agent can write to reach another project's documents.
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Uploads live beside the repo, not inside it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Documents you upload are stored in RAGBuddy's own data directory and tagged separately, so a full
            re-ingest or a sync diff never deletes them — and your repository stays exactly as you left it. The
            original file is kept rather than just its text, so an agent always reads the current extraction.
          </p>
        </div>
      </div>
    </div>
  )
}
