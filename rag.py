"""
RAGEngine: Persistent retrieval helper using FAISS + Ollama embeddings (no LLM).

What this provides
- A reusable class that keeps a persistent FAISS index under ./rag_index
- Adds raw text inputs (optionally with IDs/metadata) and saves automatically
- Removes a whole item (by your `doc_id`) from the index
- Searches top-N results and returns them with similarity scores

Usage
  from rag import RAGEngine
  engine = RAGEngine()
  engine.add_texts([{"id": "intro", "text": "Hello world", "metadata": {"section": 1}}])
  hits = engine.search("Hello", top_n=3)
  print(engine.format_results(hits))
"""
from __future__ import annotations
import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple, Union

# LangChain core
from langchain.schema import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.faiss import DistanceStrategy

# Embeddings via Ollama
try:
    from langchain_ollama import OllamaEmbeddings
except Exception:
    from langchain_community.embeddings import OllamaEmbeddings  # fallback for older installs


@dataclass
class SearchHit:
    content: str
    metadata: Dict
    score: float


class RAGEngine:
    """Persistent retrieval engine using FAISS + Ollama embeddings (no LLM).

    Methods
    -------
    add_texts(items): add raw text items (with optional ids/metadata) and persist index
    remove_item(doc_id): remove all chunks associated with a logical item id
    search(query, top_n): return top-N results as `SearchHit` objects
    format_results(results): pretty-print results as a single context string

    Notes
    -----
    - We maintain an `idmap.json` that maps your logical doc_id -> list of FAISS vector ids.
    - We chunk inputs for better recall. All chunks from the same item share the same `doc_id` in metadata.
    - Deletions remove all chunks belonging to a `doc_id`.
    """

    def __init__(
        self,
        index_dir: Union[str, Path] = "./rag_index",
        embed_model: str = os.getenv("OLLAMA_EMBED_MODEL", "embeddinggemma:300m"),
        chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", 1000)),
        chunk_overlap: int = int(os.getenv("RAG_CHUNK_OVERLAP", 150)),
        embeddings: Optional[object] = None,
        distance_strategy: DistanceStrategy = DistanceStrategy.COSINE,
    ) -> None:
        self.index_dir = Path(index_dir)
        self.idmap_path = self.index_dir / "idmap.json"
        self.embed_model = embed_model
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        self._embeddings = embeddings
        self._vs: Optional[FAISS] = None
        self.distance_strategy = distance_strategy

    # -------------------- internals --------------------
    def _log(self, msg: str) -> None:
        print(f"[RAG] {msg}")

    def _ensure_embeddings(self):
        if self._embeddings is None:
            self._embeddings = OllamaEmbeddings(model=self.embed_model)
        return self._embeddings

    def _load_vs(self) -> Optional[FAISS]:
        if not self.index_dir.exists():
            return None
        try:
            return FAISS.load_local(
                str(self.index_dir),
                self._ensure_embeddings(),
                allow_dangerous_deserialization=True,
            )
        except Exception:
            return None

    def _save_vs(self, vs: FAISS) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)
        vs.save_local(str(self.index_dir))

    def _ensure_vs(self) -> Optional[FAISS]:
        if self._vs is None:
            self._vs = self._load_vs()
        return self._vs

    def _load_idmap(self) -> Dict[str, List[str]]:
        if self.idmap_path.exists():
            try:
                return json.loads(self.idmap_path.read_text())
            except Exception:
                return {}
        return {}

    def _save_idmap(self, m: Dict[str, List[str]]) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.idmap_path.write_text(json.dumps(m, indent=2))

    def _split(self, text: str) -> List[str]:
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap
        )
        return [c.page_content for c in splitter.create_documents([text])]

    # -------------------- public API --------------------
    def add_texts(
        self,
        items: Iterable[Union[str, Dict[str, Union[str, Dict]]]],
    ) -> List[str]:
        """Add a set of text items to the index and persist.

        Parameters
        ----------
        items : Iterable[str | {"text": str, "id"?: str, "metadata"?: dict}]
            - If a string is provided, a doc_id is auto-generated.
            - If a dict is provided, you can pass an explicit `id` and arbitrary `metadata`.

        Returns
        -------
        List[str]
            The list of doc_ids (one per input item) that were added/updated.
        """
        vs = self._ensure_vs()
        idmap = self._load_idmap()
        embeddings = self._ensure_embeddings()

        added_ids: List[str] = []

        for entry in items:
            if isinstance(entry, str):
                text = entry
                doc_id = f"doc-{uuid.uuid4().hex[:8]}"
                metadata: Dict = {"source": "inline", "doc_id": doc_id}
            else:
                text = entry.get("text", "")  # type: ignore
                if not text:
                    continue
                doc_id = str(entry.get("id") or f"doc-{uuid.uuid4().hex[:8]}")  # type: ignore
                user_meta = entry.get("metadata") or {}  # type: ignore
                metadata = {"source": user_meta.get("source", "inline"), "doc_id": doc_id, **user_meta}

            # If this doc_id already exists, remove old chunks first (replace behavior)
            if doc_id in idmap and idmap[doc_id]:
                self._log(f"Replacing existing item: {doc_id}")
                try:
                    vs.delete(ids=idmap[doc_id])
                except Exception:
                    pass

            chunks = self._split(text)
            documents: List[Document] = []
            vec_ids: List[str] = []
            for idx, ch in enumerate(chunks):
                documents.append(Document(page_content=ch, metadata=metadata))
                vec_ids.append(f"{doc_id}:{idx}:{uuid.uuid4().hex[:6]}")

            # If no vector store yet, initialize from the first batch of documents
            if vs is None:
                texts = [d.page_content for d in documents]
                metas = [d.metadata for d in documents]
                vs = FAISS.from_texts(
                    texts=texts,
                    embedding=embeddings,
                    metadatas=metas,
                    ids=vec_ids,
                    distance_strategy=self.distance_strategy,
                )
            else:
                # Add with explicit IDs so we can delete later
                vs.add_documents(documents=documents, embedding=embeddings, ids=vec_ids)
            idmap[doc_id] = vec_ids
            added_ids.append(doc_id)

        # Persist
        if vs is not None:
            self._save_vs(vs)
        self._save_idmap(idmap)
        self._vs = vs
        self._log(f"Added/updated {len(added_ids)} item(s). Index saved.")
        return added_ids

    def remove_item(self, doc_id: str) -> int:
        """Remove a logical item (all its chunks) by `doc_id`.

        Returns the number of vector IDs removed (0 if none).
        """
        vs = self._ensure_vs()
        if vs is None:
            self._log("Index not found. Nothing to remove.")
            return 0
        idmap = self._load_idmap()
        vec_ids = idmap.get(doc_id, [])
        if not vec_ids:
            self._log(f"No item found with id: {doc_id}")
            return 0
        try:
            vs.delete(ids=vec_ids)
        except Exception:
            pass
        # Update idmap and persist
        removed = len(vec_ids)
        idmap.pop(doc_id, None)
        self._save_vs(vs)
        self._save_idmap(idmap)
        self._vs = vs
        self._log(f"Removed {removed} vectors for item '{doc_id}'.")
        return removed

    def search(self, query: str, top_n: int = 5) -> List[SearchHit]:
        """Search and return top-N results with scores (lower score = more similar)."""
        vs = self._ensure_vs()
        if vs is None:
            return []
        results = vs.similarity_search_with_score(query, k=top_n)
        # Ensure results are ordered by ascending distance (lower = better)
        results = sorted(results, key=lambda pair: float(pair[1]))
        hits: List[SearchHit] = []
        for doc, score in results:
            hits.append(SearchHit(content=doc.page_content, metadata=doc.metadata or {}, score=float(score)))
        return hits

    def format_results(self, results: List[SearchHit]) -> str:
        """Pretty-print search results into a single context string."""
        lines: List[str] = []
        for i, r in enumerate(results, 1):
            src = r.metadata.get("source", "inline")
            doc_id = r.metadata.get("doc_id", "?")
            page = r.metadata.get("page")
            tag = f"[source: {src}{f' p.{page+1}' if isinstance(page, int) else ''} id:{doc_id}]"
            lines.append(f"--- Result {i} (distance={r.score:.4f}) {tag} --- {r.content}")
        return "\n\n".join(lines)

