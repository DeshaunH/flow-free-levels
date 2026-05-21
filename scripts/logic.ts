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

function tryGenerateConstructive(config: GenConfig, _diff: Difficulty): PuzzleResult | null {
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
