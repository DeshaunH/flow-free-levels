明白！为了绝对避免歧义，并确保你可以一次性复制粘贴跑通整个流程，我为你整理了**完整的项目目录结构**以及**每一份文件的完整代码**。

我们将彻底抛弃原本的 Python 脚本，完全转为 Node.js (TypeScript) 体系。

### 📁 最终的仓库目录结构

请确保你的 `flow-free-generate` 仓库最终是这个层级结构（**请删除之前的 `.py` 脚本**）：

```text
flow-free-generate/
├── .github/
│   └── workflows/
│       └── generate.yml      # GitHub Action 自动化配置
├── scripts/
│   ├── types.ts              # 共享类型定义 (新增)
│   ├── logic.ts              # 核心生成算法 (你提供的原版 + 尾部导出)
│   └── build_levels.ts       # 底池生成与 100 关筛选器 (核心编排脚本)
├── package.json              # Node.js 依赖配置
├── tsconfig.json             # TypeScript 编译配置
└── levels/                   # (运行后自动生成的 100 关 JSON 存放处)

```

---

以下是这 **6 个文件** 的完整代码。请直接复制替换你仓库里的内容。

### 1. `package.json` (放在根目录)

用于安装执行环境。

```json
{
  "name": "flow-free-generate",
  "version": "1.0.0",
  "description": "TypeScript level generator and sorter",
  "scripts": {
    "generate": "ts-node scripts/build_levels.ts"
  },
  "dependencies": {
    "ts-node": "^10.9.1",
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}

```

### 2. `tsconfig.json` (放在根目录)

用于保证 TS 编译不报错。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["scripts/**/*"]
}

```

### 3. `.github/workflows/generate.yml`

配置 GitHub Action 执行 Node 脚本并提交 100 关数据。

```yaml
name: Generate Levels

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 1' # 每周一自动运行

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install Dependencies
        run: npm install

      - name: Generate and Sort Levels
        run: npm run generate

      - name: Commit and Push
        run: |
          git config --global user.name 'github-actions[bot]'
          git config --global user.email 'github-actions[bot]@users.noreply.github.com'
          git add levels/
          git commit -m "Auto-generate 100 structured levels via TS pool" || echo "No changes to commit"
          git push

```

### 4. `scripts/types.ts`

因为 `logic.ts` 依赖类型，这里必须提供完整的接口定义。

```typescript
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';

export interface Position {
    r: number;
    c: number;
}

export enum CellType {
    Normal = 'normal',
    Wall = 'wall',
    Block = 'block',
    Bridge = 'bridge',
    Harmony = 'harmony',
    Blend = 'blend',
    Vortex = 'vortex',
    Tunnel = 'tunnel'
}

export interface CellData {
    r: number;
    c: number;
    type: string;
    color: number;
    isEndpoint: boolean;
    isMultiColorEndpoint?: boolean;
    multiColors?: number[];
    connectedColors?: Set<number>;
    blendInputs?: number[];
    blendOutput?: number;
    blendActivated?: boolean;
    bridgeColors?: number[];
    tunnelId?: number;
    tunnelColor?: string;
    tunnelActivatedColor?: string | null;
}

```

### 5. `scripts/logic.ts`

这是你发给我的**完整算法**，我**只在最底部添加了** `generateCustomPuzzle` 的导出，以便外部脚本调用。

*(由于代码较长，请完整复制)*

```typescript
import type { Difficulty, CellData, Position, CellType } from './types';

const DIFF_CONFIG = {
    easy: { cols: 6, rows: 6, colors: 4, walls: 2, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    medium: { cols: 7, rows: 7, colors: 5, walls: 3, bridges: 2, hasBlend: false, multiColorCount: 1, tunnels: 0 },
    hard: { cols: 8, rows: 8, colors: 6, walls: 4, bridges: 2, hasBlend: true, multiColorCount: 2, tunnels: 1 },
    master: { cols: 8, rows: 12, colors: 7, walls: 5, bridges: 3, hasBlend: true, multiColorCount: 3, tunnels: 2 }
};

const TUNNEL_COLORS = ["#FF0000", "#00FF00", "#0000FF", "#FFD700"];

const LAST_SUCCESS = new Map<string, PuzzleResult>();

function getCacheKey(difficulty: Difficulty, seed?: string): string {
    return `${difficulty}:${seed || "__random__"}`;
}

type RandomSource = () => number;
let currentRandomSource: RandomSource = Math.random;

function random(): number { return currentRandomSource(); }

function withRandomSource<T>(source: RandomSource, fn: () => T): T {
    const previous = currentRandomSource;
    currentRandomSource = source;
    try { return fn(); } finally { currentRandomSource = previous; }
}

function hashSeed(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
}

function createSeededRandom(seed: string): RandomSource {
    let t = hashSeed(seed);
    return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

export interface PuzzleResult { grid: CellData[][], solutionPaths: Record<number, Position[]> };

export function generatePuzzle(difficulty: Difficulty, seed?: string): PuzzleResult {
    const config = DIFF_CONFIG[difficulty];
    const cacheKey = getCacheKey(difficulty, seed);

    const generateFn = () => {
        for (let retry = 0; retry < 1500; retry++) {
            const result = tryGenerateConstructive(config, difficulty);
            if (result) {
                LAST_SUCCESS.set(cacheKey, { grid: cloneGrid(result.grid), solutionPaths: result.solutionPaths });
                return result;
            }
        }
        const cached = LAST_SUCCESS.get(cacheKey);
        if (cached) return { grid: cloneGrid(cached.grid), solutionPaths: cached.solutionPaths };
        return fallbackGenerate(config.cols, config.rows, config.colors);
    };

    if (!seed) return withRandomSource(Math.random, generateFn);
    return withRandomSource(createSeededRandom(seed), generateFn);
}

export interface GenConfig {
    cols: number;
    rows: number;
    colors: number;
    walls: number;
    bridges: number;
    hasBlend: boolean;
    multiColorCount: number;
    tunnels: number;
}

interface PathStrand {
    nodes: Position[];
    frontOpen: boolean;
    backOpen: boolean;
}

function tryGenerateConstructive(config: GenConfig, diff: Difficulty): PuzzleResult | null {
    const cols = config.cols;
    const rows = config.rows;
    const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
    const specials = new Map<string, any>();

    const inBounds = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols;
    const isEmpty = (r: number, c: number) => inBounds(r, c) && grid[r][c] === 0;

    const shellBounds = Array.from({ length: rows }, () => Array(cols).fill(false));
    const markShell = (r: number, c: number) => {
        for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
                if (Math.abs(dr) + Math.abs(dc) <= 2) {
                    if (inBounds(r + dr, c + dc)) shellBounds[r + dr][c + dc] = true;
                }
            }
        }
    };

    const colorPool = Array.from({ length: config.colors }, (_, i) => i + 1);
    const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => random() - 0.5);

    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][];

    let tunnelShells: { r1: number, c1: number, r2: number, c2: number, id: number }[] = [];
    if (config.tunnels > 0) {
        let placedTunnels = 0;
        let tunnelAttempts = 0;
        while (placedTunnels < config.tunnels && tunnelAttempts < 200) {
            tunnelAttempts++;
            let r1 = Math.floor(random() * (rows - 2)) + 1;
            let c1 = Math.floor(random() * (cols - 2)) + 1;
            let r2 = Math.floor(random() * (rows - 2)) + 1;
            let c2 = Math.floor(random() * (cols - 2)) + 1;
            if (!shellBounds[r1][c1] && !shellBounds[r2][c2] && (Math.abs(r1 - r2) + Math.abs(c1 - c2) >= 3)) {
                shellBounds[r1][c1] = true;
                shellBounds[r2][c2] = true;
                for (let [dr, dc] of DIRS) {
                    if (inBounds(r1 + dr, c1 + dc)) shellBounds[r1 + dr][c1 + dc] = true;
                    if (inBounds(r2 + dr, c2 + dc)) shellBounds[r2 + dr][c2 + dc] = true;
                }
                tunnelShells.push({ r1, c1, r2, c2, id: placedTunnels + 1 });
                placedTunnels++;
            }
        }
    }

    let bridgeShells: Position[] = [];
    for (let i = 0; i < config.bridges; i++) {
        let placed = false;
        for (let a = 0; a < 50; a++) {
            const r = Math.floor(random() * (rows - 2)) + 1;
            const c = Math.floor(random() * (cols - 2)) + 1;
            if (!shellBounds[r][c]) {
                bridgeShells.push({ r, c });
                markShell(r, c);
                placed = true;
                break;
            }
        }
        if (!placed) return null;
    }

    let blendShell: Position | null = null;
    if (config.hasBlend) {
        let placed = false;
        for (let a = 0; a < 50; a++) {
            const r = Math.floor(random() * (rows - 2)) + 1;
            const c = Math.floor(random() * (cols - 2)) + 1;
            if (!shellBounds[r][c]) {
                blendShell = { r, c };
                markShell(r, c);
                placed = true;
                break;
            }
        }
        if (!placed) return null;
    }

    let multiShell: Position | null = null;
    if (config.multiColorCount >= 2) {
        let placed = false;
        for (let a = 0; a < 200; a++) {
            const r = Math.floor(random() * (rows - 2)) + 1;
            const c = Math.floor(random() * (cols - 2)) + 1;
            if (!shellBounds[r][c]) {
                multiShell = { r, c };
                markShell(r, c);
                placed = true;
                break;
            }
        }
        if (!placed) return null;
    }

    const colorStrands = new Map<number, PathStrand[]>();
    for (let c = 1; c <= config.colors; c++) colorStrands.set(c, []);

    for (let i = 0; i < tunnelShells.length; i++) {
        let t = tunnelShells[i];
        let color = shuffle([...colorPool])[0];
        let tunnelColor = TUNNEL_COLORS[(t.id - 1) % TUNNEL_COLORS.length];
        specials.set(`${t.r1},${t.c1}`, { type: 'tunnel', id: t.id, tunnelColor });
        specials.set(`${t.r2},${t.c2}`, { type: 'tunnel', id: t.id, tunnelColor });

        grid[t.r1][t.c1] = color;
        grid[t.r2][t.c2] = color;

        colorStrands.get(color)!.push({
            nodes: [{ r: t.r1, c: t.c1 }, { r: t.r2, c: t.c2 }],
            frontOpen: true,
            backOpen: true
        });
    }

    if (multiShell) {
        let mColors = shuffle(colorPool).slice(0, config.multiColorCount);
        grid[multiShell.r][multiShell.c] = -1;
        specials.set(`${multiShell.r},${multiShell.c}`, { type: 'multi', colors: mColors });

        const DIRS_SHUF = [...DIRS].sort(() => random() - 0.5);
        for (let i = 0; i < mColors.length; i++) {
            const cId = mColors[i];
            const nr = multiShell.r + DIRS_SHUF[i][0];
            const nc = multiShell.c + DIRS_SHUF[i][1];
            grid[nr][nc] = cId;
            colorStrands.get(cId)!.push({
                nodes: [{ r: multiShell.r, c: multiShell.c }, { r: nr, c: nc }],
                frontOpen: false,
                backOpen: true
            });
        }
    }

    if (blendShell) {
        let bColors = shuffle(colorPool).slice(0, 2);
        const ci = bColors[0];
        const co = bColors[1];
        grid[blendShell.r][blendShell.c] = -1;
        specials.set(`${blendShell.r},${blendShell.c}`, { type: 'blend', ci, co });

        grid[blendShell.r][blendShell.c - 1] = ci; grid[blendShell.r][blendShell.c + 1] = ci;
        colorStrands.get(ci)!.push({
            nodes: [{ r: blendShell.r, c: blendShell.c - 1 }, { r: blendShell.r, c: blendShell.c }, { r: blendShell.r, c: blendShell.c + 1 }],
            frontOpen: true, backOpen: true
        });

        grid[blendShell.r - 1][blendShell.c] = co; grid[blendShell.r + 1][blendShell.c] = co;
        colorStrands.get(co)!.push({
            nodes: [{ r: blendShell.r - 1, c: blendShell.c }, { r: blendShell.r, c: blendShell.c }, { r: blendShell.r + 1, c: blendShell.c }],
            frontOpen: true, backOpen: true
        });
    }

    for (const bShell of bridgeShells) {
        let bColors = shuffle(colorPool).slice(0, 2);
        const c1 = bColors[0];
        const c2 = bColors[1];
        grid[bShell.r][bShell.c] = -1;
        specials.set(`${bShell.r},${bShell.c}`, { type: 'bridge', c1, c2 });

        grid[bShell.r][bShell.c - 1] = c1; grid[bShell.r][bShell.c + 1] = c1;
        colorStrands.get(c1)!.push({
            nodes: [{ r: bShell.r, c: bShell.c - 1 }, { r: bShell.r, c: bShell.c }, { r: bShell.r, c: bShell.c + 1 }],
            frontOpen: true, backOpen: true
        });

        grid[bShell.r - 1][bShell.c] = c2; grid[bShell.r + 1][bShell.c] = c2;
        colorStrands.get(c2)!.push({
            nodes: [{ r: bShell.r - 1, c: bShell.c }, { r: bShell.r, c: bShell.c }, { r: bShell.r + 1, c: bShell.c }],
            frontOpen: true, backOpen: true
        });
    }

    for (let c = 1; c <= config.colors; c++) {
        if (colorStrands.get(c)!.length === 0) {
            let placed = false;
            for (let a = 0; a < 50; a++) {
                const r = Math.floor(random() * rows);
                const cIdx = Math.floor(random() * cols);
                if (isEmpty(r, cIdx)) {
                    grid[r][cIdx] = c;
                    colorStrands.get(c)!.push({
                        nodes: [{ r, c: cIdx }],
                        frontOpen: true, backOpen: true
                    });
                    placed = true;
                    break;
                }
            }
            if (!placed) return null;
        }
    }

    for (let c = 1; c <= config.colors; c++) {
        let strands = colorStrands.get(c)!;
        while (strands.length > 1) {
            let s1 = strands[0];
            let s2 = strands[1];

            let opts: [boolean, boolean][] = [];
            if (s1.frontOpen && s2.frontOpen) opts.push([true, true]);
            if (s1.frontOpen && s2.backOpen) opts.push([true, false]);
            if (s1.backOpen && s2.frontOpen) opts.push([false, true]);
            if (s1.backOpen && s2.backOpen) opts.push([false, false]);

            opts = shuffle(opts as any) as any;
            let pathFound = false;

            for (let opt of opts) {
                const s1Front = opt[0];
                const s2Front = opt[1];

                const start = s1Front ? s1.nodes[0] : s1.nodes[s1.nodes.length - 1];
                const goal = s2Front ? s2.nodes[0] : s2.nodes[s2.nodes.length - 1];

                let q: { r: number, c: number, path: Position[] }[] = [{ r: start.r, c: start.c, path: [] }];
                let visited = new Set<string>();
                visited.add(`${start.r},${start.c}`);

                let foundPath: Position[] | null = null;

                while (q.length > 0) {
                    const curr = q.shift()!;
                    if (curr.r === goal.r && curr.c === goal.c) {
                        foundPath = curr.path;
                        break;
                    }
                    for (const [dr, dc] of DIRS) {
                        const nr = curr.r + dr;
                        const nc = curr.c + dc;
                        const key = `${nr},${nc}`;
                        if (nr === goal.r && nc === goal.c) {
                            foundPath = [...curr.path, { r: nr, c: nc }];
                            break;
                        }
                        if (isEmpty(nr, nc) && !visited.has(key)) {
                            visited.add(key);
                            q.push({ r: nr, c: nc, path: [...curr.path, { r: nr, c: nc }] });
                        }
                    }
                    if (foundPath) break;
                }

                if (foundPath) {
                    let body = foundPath.slice(0, -1);
                    for (let p of body) {
                        grid[p.r][p.c] = c;
                    }

                    let s1List = [...s1.nodes];
                    if (!s1Front) s1List.reverse();

                    let s2List = [...s2.nodes];
                    if (s2Front) s2List.reverse();

                    let newNodes = [];
                    let newFrontOpen = false;
                    let newBackOpen = false;

                    if (s1Front) {
                        let revBody = [...body].reverse();
                        newNodes = [...revBody, ...s1.nodes];
                        newBackOpen = s1.backOpen;
                    } else {
                        newNodes = [...s1.nodes, ...body];
                        newFrontOpen = s1.frontOpen;
                    }

                    if (s2Front) {
                        if (s1Front) {
                            newNodes = [...s2.nodes.slice().reverse(), ...newNodes];
                            newFrontOpen = s2.backOpen;
                        } else {
                            newNodes = [...newNodes, ...s2.nodes];
                            newBackOpen = s2.backOpen;
                        }
                    } else {
                        if (s1Front) {
                            newNodes = [...s2.nodes, ...newNodes];
                            newFrontOpen = s2.frontOpen;
                        } else {
                            newNodes = [...newNodes, ...s2.nodes.slice().reverse()];
                            newBackOpen = s2.frontOpen;
                        }
                    }

                    strands.splice(0, 2);
                    strands.push({
                        nodes: newNodes,
                        frontOpen: newFrontOpen,
                        backOpen: newBackOpen
                    });

                    pathFound = true;
                    break;
                }
            }
            if (!pathFound) return null; 
        }
    }

    let madeProgress = true;
    while (madeProgress) {
        madeProgress = false;
        let cKeys = shuffle(colorPool);
        for (let c of cKeys) {
            let strand = colorStrands.get(c)![0];

            if (strand.frontOpen) {
                let head = strand.nodes[0];
                let dirs = shuffle([[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]);
                for (let dir of dirs) {
                    let nr = head.r + dir[0];
                    let nc = head.c + dir[1];
                    if (isEmpty(nr, nc)) {
                        let selfTouch = 0;
                        for (let [or, oc] of DIRS) {
                            if (inBounds(nr + or, nc + oc) && grid[nr + or][nc + oc] === c) selfTouch++;
                        }
                        if (selfTouch === 1) {
                            grid[nr][nc] = c;
                            strand.nodes.unshift({ r: nr, c: nc });
                            madeProgress = true;
                            break;
                        }
                    }
                }
            }

            if (strand.backOpen) {
                let tail = strand.nodes[strand.nodes.length - 1];
                let dirs = shuffle([[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]);
                for (let dir of dirs) {
                    let nr = tail.r + dir[0];
                    let nc = tail.c + dir[1];
                    if (isEmpty(nr, nc)) {
                        let selfTouch = 0;
                        for (let [or, oc] of DIRS) {
                            if (inBounds(nr + or, nc + oc) && grid[nr + or][nc + oc] === c) selfTouch++;
                        }
                        if (selfTouch === 1) {
                            grid[nr][nc] = c;
                            strand.nodes.push({ r: nr, c: nc });
                            madeProgress = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    const resultData: CellData[][] = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c): CellData => ({
            r, c, type: 'wall', color: 0, isEndpoint: false
        }))
    );

    const solutionPaths: Record<number, Position[]> = {};

    for (let c = 1; c <= config.colors; c++) {
        let strand = colorStrands.get(c)![0];
        if (strand.nodes.length < 2) return null;
        for (let p of strand.nodes) {
            if (!specials.has(`${p.r},${p.c}`)) {
                resultData[p.r][p.c].type = 'normal';
            }
        }

        let head = strand.nodes[0];
        let tail = strand.nodes[strand.nodes.length - 1];

        if (!specials.has(`${head.r},${head.c}`)) {
            resultData[head.r][head.c].isEndpoint = true;
            resultData[head.r][head.c].color = c;
        } else if (specials.get(`${head.r},${head.c}`)?.type !== 'multi') return null;

        if (!specials.has(`${tail.r},${tail.c}`)) {
            resultData[tail.r][tail.c].isEndpoint = true;
            resultData[tail.r][tail.c].color = c;
        } else if (specials.get(`${tail.r},${tail.c}`)?.type !== 'multi') return null;
        solutionPaths[c] = strand.nodes;
    }

    for (const [key, spec] of specials.entries()) {
        const [rStr, cStr] = key.split(',');
        const r = parseInt(rStr);
        const c = parseInt(cStr);

        if (spec.type === 'bridge') {
            resultData[r][c].type = 'bridge';
            resultData[r][c].bridgeColors = [spec.c1, spec.c2];
        } else if (spec.type === 'blend') {
            resultData[r][c].type = 'blend';
            resultData[r][c].blendInputs = [spec.ci];
            resultData[r][c].blendOutput = spec.co;
            resultData[r][c].blendActivated = false;
        } else if (spec.type === 'multi') {
            resultData[r][c].type = 'normal';
            resultData[r][c].isEndpoint = true;
            resultData[r][c].isMultiColorEndpoint = true;
            resultData[r][c].multiColors = spec.colors;
            resultData[r][c].connectedColors = new Set();
        } else if (spec.type === 'tunnel') {
            resultData[r][c].type = 'tunnel';
            resultData[r][c].tunnelId = spec.id;
            resultData[r][c].tunnelColor = spec.tunnelColor;
            resultData[r][c].tunnelActivatedColor = null;
        }
    }

    return { grid: resultData, solutionPaths };
}

function cloneGrid(grid: CellData[][]): CellData[][] {
    return grid.map((row) =>
        row.map((cell) => ({
            ...cell,
            multiColors: cell.multiColors ? [...cell.multiColors] : undefined,
            connectedColors: cell.connectedColors ? new Set(cell.connectedColors) : undefined,
            blendInputs: cell.blendInputs ? [...cell.blendInputs] : undefined,
            bridgeColors: cell.bridgeColors ? [...cell.bridgeColors] : undefined
        }))
    );
}

function fallbackGenerate(cols: number, rows: number, colors: number): PuzzleResult {
    const result: CellData[][] = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c): CellData => ({
            r, c, type: 'wall', color: 0, isEndpoint: false
        }))
    );
    const solutionPaths: Record<number, Position[]> = {};
    for (let c = 0; c < colors; c++) {
        const row = c * 2;
        if (row >= rows || c >= 5) break;
        result[row][0].type = 'normal'; result[row][0].isEndpoint = true; result[row][0].color = c + 1;
        result[row][1].type = 'normal';
        result[row][2].type = 'normal'; result[row][2].isEndpoint = true; result[row][2].color = c + 1;
        solutionPaths[c + 1] = [{ r: row, c: 0 }, { r: row, c: 1 }, { r: row, c: 2 }];
    }
    return { grid: result, solutionPaths };
}

// ==========================================
// 暴露给外部调用的自定义生成接口
// ==========================================
export function generateCustomPuzzle(config: GenConfig, seed?: string): PuzzleResult | null {
    const generateFn = () => {
        for (let retry = 0; retry < 1500; retry++) {
            const result = tryGenerateConstructive(config, 'easy');
            if (result) return { grid: cloneGrid(result.grid), solutionPaths: result.solutionPaths };
        }
        return null;
    };
    if (!seed) return withRandomSource(Math.random, generateFn);
    return withRandomSource(createSeededRandom(seed), generateFn);
}

```

### 6. `scripts/build_levels.ts`

这是你的新“流水线引擎”。它实现了**底池生成+关卡严选**。完全契合你要求的“1-5关5x5、6-10有block、逐渐增加到8x12”。

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { generateCustomPuzzle, GenConfig } from './logic';
import { CellData } from './types';

const OUTPUT_DIR = path.join(__dirname, '../levels');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 1. 底池模板库 (覆盖所有组合可能)
const POOL_TEMPLATES: GenConfig[] = [
    { cols: 5, rows: 5, colors: 3, walls: 0, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 5, rows: 5, colors: 4, walls: 0, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 6, rows: 6, colors: 4, walls: 2, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 6, rows: 6, colors: 5, walls: 3, bridges: 1, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 7, rows: 7, colors: 5, walls: 3, bridges: 0, hasBlend: true, multiColorCount: 0, tunnels: 0 },
    { cols: 7, rows: 7, colors: 6, walls: 4, bridges: 1, hasBlend: true, multiColorCount: 1, tunnels: 0 },
    { cols: 8, rows: 8, colors: 6, walls: 4, bridges: 2, hasBlend: true, multiColorCount: 2, tunnels: 0 },
    { cols: 8, rows: 10, colors: 7, walls: 5, bridges: 2, hasBlend: true, multiColorCount: 2, tunnels: 1 },
    { cols: 8, rows: 12, colors: 7, walls: 6, bridges: 3, hasBlend: true, multiColorCount: 3, tunnels: 2 }
];

function analyzePuzzle(grid: CellData[][]) {
    let walls = 0, bridges = 0, blends = 0, multis = 0, tunnels = 0;
    grid.forEach(row => {
        row.forEach(cell => {
            if (cell.type === 'wall' || cell.type === 'block') walls++; 
            if (cell.type === 'bridge') bridges++;
            if (cell.type === 'blend' || cell.type === 'harmony') blends++; 
            if (cell.isMultiColorEndpoint) multis++;
            if (cell.type === 'tunnel') tunnels++;
        });
    });
    return { rows: grid.length, cols: grid[0].length, walls, bridges, blends, multis, tunnels };
}

// 2. 1-100关的难度曲线要求
function getRequirementForLevel(level: number) {
    if (level >= 1 && level <= 5) return { r: 5, c: 5, reqWalls: 0, exact: [] }; // 5x5, 无机制
    if (level >= 6 && level <= 10) return { r: 6, c: 6, reqWalls: 1, exact: [] }; // 6x6, 有 block
    if (level >= 11 && level <= 20) return { r: 6, c: 6, reqWalls: 1, exact: ['bridge'] }; // 桥
    if (level >= 21 && level <= 30) return { r: 7, c: 7, reqWalls: 1, exact: ['blend'] }; // 调和站
    if (level >= 31 && level <= 40) return { r: 7, c: 7, reqWalls: 1, exact: ['bridge', 'blend'] }; // 桥+调和站
    if (level >= 41 && level <= 60) return { r: 8, c: 8, reqWalls: 1, exact: ['bridge', 'blend', 'multi'] }; 
    if (level >= 61 && level <= 80) return { r: 8, c: 10, reqWalls: 2, minSpecials: 3 }; // 8x10 混合
    if (level >= 81 && level <= 100) return { r: 8, c: 12, reqWalls: 3, minSpecials: 4 }; // 8x12 Master
    return { r: 8, c: 12, reqWalls: 1, minSpecials: 1 };
}

async function buildLevels() {
    console.log('🚀 开始在内存中生成 1000 关底池...');
    const pool: any[] = [];
    let attempts = 0;

    while (pool.length < 1000) {
        attempts++;
        const base = POOL_TEMPLATES[Math.floor(Math.random() * POOL_TEMPLATES.length)];
        const config: GenConfig = { ...base, colors: base.colors + (Math.random() > 0.7 ? 1 : 0) };
        const seed = `pool-${Date.now()}-${attempts}`;
        const result = generateCustomPuzzle(config, seed);

        if (result) {
            pool.push({
                seed, config, grid: result.grid, solutionPaths: result.solutionPaths,
                stats: analyzePuzzle(result.grid), used: false
            });
            if (pool.length % 200 === 0) console.log(`已生成 ${pool.length} 关...`);
        }
    }
    console.log(`✅ 底池生成完毕！尝试次数: ${attempts}`);

    console.log('🔍 开始筛选 100 关...');
    for (let i = 1; i <= 100; i++) {
        const req = getRequirementForLevel(i);
        
        let bestMatch = pool.find(p => {
            if (p.used) return false;
            if (p.stats.rows !== req.r || p.stats.cols !== req.c) return false;
            if (req.reqWalls === 0 && p.stats.walls > 0) return false;
            if (req.reqWalls > 0 && p.stats.walls < req.reqWalls) return false;

            if (req.exact) {
                const hasBridge = p.stats.bridges > 0;
                const hasBlend = p.stats.blends > 0;
                const hasMulti = p.stats.multis > 0;
                if (req.exact.includes('bridge') !== hasBridge) return false;
                if (req.exact.includes('blend') !== hasBlend) return false;
                if (req.exact.includes('multi') !== hasMulti) return false;
            }

            if (req.minSpecials) {
                let sCount = (p.stats.bridges > 0 ? 1 : 0) + (p.stats.blends > 0 ? 1 : 0) + 
                             (p.stats.multis > 0 ? 1 : 0) + (p.stats.tunnels > 0 ? 1 : 0);
                if (sCount < req.minSpecials) return false;
            }
            return true;
        });

        if (!bestMatch) {
            console.warn(`⚠️ 第 ${i} 关未找到完美匹配，启动降级匹配...`);
            bestMatch = pool.find(p => !p.used && p.stats.rows <= req.r && p.stats.cols <= req.c);
        }

        if (bestMatch) {
            bestMatch.used = true;
            const outputData = {
                difficulty: "auto",
                seed: bestMatch.seed,
                grid: bestMatch.grid,
                solutionPaths: bestMatch.solutionPaths,
                metadata: { ...bestMatch.stats, level: i }
            };
            fs.writeFileSync(path.join(OUTPUT_DIR, `level_${i}.json`), JSON.stringify(outputData));
        } else {
            console.error(`❌ 严重错误：无法生成第 ${i} 关！`);
            break;
        }
    }
    console.log('🎉 1-100 关卡替换完成！');
}

buildLevels();

```

按照这个结构替换文件后，你只需在仓库中触发 Action，系统就会自动帮你执行完全由 TS 驱动的底层生成和 1-100 关的精准筛选！