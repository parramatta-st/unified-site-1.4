export type CatalogItem = {
  id: number;
  year?: string;
  subject?: string;
  topic?: string;
  type?: string;
  name?: string;
  item_type?: string;
  item_name?: string;
  path?: string;
  page_count?: number;
  file_bytes?: number;
  active?: number;
};

export type FileCategory = 'lesson' | 'revision' | 'assessment' | 'homework' | 'file';

export type TreeFile = CatalogItem & {
  fileName: string;
  folderSegments: string[];
  _typeLabel?: string;
  _nameLabel?: string;
  _sortKey?: [number, number, number, string];
  _category?: FileCategory;
  _sequence?: number | null;
};

export type TreeNode = {
  name: string;
  pathSegments: string[];
  children: Map<string, TreeNode>;
  files: TreeFile[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\//, '');
}

function splitPath(p?: string) {
  if (!p) return [];
  return normalizePath(p).split('/').filter(Boolean);
}

export function buildCatalogTree(items: CatalogItem[]): TreeNode {
  const root: TreeNode = { name: '__root__', pathSegments: [], children: new Map(), files: [] };

  for (const it of items || []) {
    if (!it?.path) continue;
    const parts = splitPath(it.path);
    if (parts.length < 2) continue;
    const fileName = parts[parts.length - 1];
    const folderSegments = parts.slice(0, -1);

    let node = root;
    for (const seg of folderSegments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          name: seg,
          pathSegments: [...node.pathSegments, seg],
          children: new Map(),
          files: [],
        });
      }
      node = node.children.get(seg)!;
    }

    node.files.push({ ...it, fileName, folderSegments });
  }

  if (root.children.size === 1) {
    const only = [...root.children.values()][0];
    if (only.name.toLowerCase() === 'content') return only;
  }

  return root;
}

export function getNode(root: TreeNode, pathSegments: string[]): TreeNode {
  let node = root;
  for (const seg of pathSegments) {
    const next = node.children.get(seg);
    if (!next) return node;
    node = next;
  }
  return node;
}

export function listChildNames(node: TreeNode): string[] {
  return [...node.children.keys()].sort(collator.compare);
}

export function isStandardYearLabel(label: string) {
  const l = label.trim().toLowerCase();
  if (l === 'kindy' || l === 'kindergarten') return true;
  if (l.startsWith('year ')) {
    const n = parseInt(l.replace('year ', ''), 10);
    return Number.isFinite(n) && n >= 1 && n <= 12;
  }
  return false;
}

export type SortResult = {
  category: FileCategory;
  typeLabel: string;
  nameLabel: string;
  sequence: number | null;
  sortKey: [number, number, number, string];
};

export function parseFileSort(fileName: string): SortResult {
  const base = fileName.replace(/\.[^/.]+$/, '');
  const cleaned = base.trim();
  const upper = cleaned.toUpperCase();

  const mLesson = upper.match(/^(?:L\s*(\d{1,2})\b|LESSON\s*(\d{1,2})\b)/);
  if (mLesson) {
    const n = parseInt(mLesson[1] || mLesson[2], 10);
    return { category: 'lesson', typeLabel: 'Lesson', nameLabel: `Lesson ${n}`, sequence: n, sortKey: [0, n, 0, cleaned] };
  }

  const mRevision = upper.match(/^(?:R\s*(\d{1,2})\b|REVISION\s*(\d{1,2})\b|REV\s*(\d{1,2})\b)/);
  if (mRevision) {
    const n = parseInt(mRevision[1] || mRevision[2] || mRevision[3], 10);
    return { category: 'revision', typeLabel: 'Revision', nameLabel: `Revision ${n}`, sequence: n, sortKey: [0, n, 1, cleaned] };
  }

  if (upper.includes('ASSESSMENT') || upper === 'A' || upper.startsWith('A ')) {
    return { category: 'assessment', typeLabel: 'Assessment', nameLabel: 'Assessment', sequence: null, sortKey: [1, 0, 0, cleaned] };
  }

  const mHomework = upper.match(/^(?:H\s*(\d{1,2})\b|HW\s*(\d{1,2})\b|HOMEWORK\s*(\d{1,2})\b|HWK\s*(\d{1,2})\b)/);
  if (mHomework) {
    const n = parseInt(mHomework[1] || mHomework[2] || mHomework[3] || mHomework[4], 10);
    return { category: 'homework', typeLabel: 'Homework', nameLabel: `Homework ${n}`, sequence: n, sortKey: [2, n, 0, cleaned] };
  }

  return { category: 'file', typeLabel: 'File', nameLabel: cleaned, sequence: null, sortKey: [3, 0, 0, cleaned] };
}

function analyzeFiles(files: TreeFile[]) {
  let hasLesson = false;
  let hasRevision = false;

  for (const file of files || []) {
    const info = parseFileSort(file.fileName);
    if (info.category === 'lesson') hasLesson = true;
    if (info.category === 'revision') hasRevision = true;
    if (hasLesson && hasRevision) break;
  }

  return { hasLesson, hasRevision, hasLessonRevisionPair: hasLesson && hasRevision };
}

export function sortFilesForDisplay(files: TreeFile[], standardOrdering: boolean) {
  const { hasLessonRevisionPair } = analyzeFiles(files || []);
  const useStructuredOrdering = standardOrdering || hasLessonRevisionPair;

  const mapped = (files || []).map((file) => {
    const info = parseFileSort(file.fileName);
    const treatRevisionAsGeneric = info.category === 'revision' && !hasLessonRevisionPair;

    return {
      ...file,
      _category: treatRevisionAsGeneric ? 'file' : info.category,
      _typeLabel: treatRevisionAsGeneric ? 'File' : info.typeLabel,
      _nameLabel: treatRevisionAsGeneric ? file.fileName.replace(/\.[^/.]+$/, '').trim() : info.nameLabel,
      _sequence: treatRevisionAsGeneric ? null : info.sequence,
      _sortKey: treatRevisionAsGeneric ? ([3, 0, 0, file.fileName] as [number, number, number, string]) : info.sortKey,
    };
  });

  mapped.sort((a, b) => {
    if (useStructuredOrdering) {
      const aKey = a._sortKey || [3, 0, 0, a.fileName];
      const bKey = b._sortKey || [3, 0, 0, b.fileName];
      for (let i = 0; i < aKey.length; i++) {
        const av = aKey[i];
        const bv = bKey[i];
        if (typeof av === 'number' && typeof bv === 'number') {
          if (av !== bv) return av - bv;
        } else {
          const cmp = collator.compare(String(av), String(bv));
          if (cmp !== 0) return cmp;
        }
      }
      return 0;
    }

    return collator.compare(a.fileName, b.fileName);
  });

  return mapped;
}

export function collectDescendantFiles(node: TreeNode, standardOrdering: boolean): TreeFile[] {
  const out: TreeFile[] = [];
  out.push(...sortFilesForDisplay(node.files || [], standardOrdering));

  const childNodes = [...node.children.values()].sort((a, b) => collator.compare(a.name, b.name));
  for (const child of childNodes) {
    out.push(...collectDescendantFiles(child, standardOrdering));
  }

  return out;
}

export function getFolderLabel(pathSegments: string[]) {
  return (pathSegments || []).join(' / ');
}
