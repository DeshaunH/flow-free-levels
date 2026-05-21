import * as fs from 'fs';
import * as path from 'path';
import { generateCustomPuzzle, GenConfig } from './logic';
import { CellData, Position } from './types';

const dirName = process.env.LEVELS_DIR || 'levels';
const OUTPUT_DIR = path.join(__dirname, '..', dirName);

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 1. 底池模板库 (覆盖所有组合可能)
const POOL_TEMPLATES: GenConfig[] = [
    { cols: 5, rows: 5, colors: 3, walls: 0, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 5, rows: 5, colors: 4, walls: 0, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 5, rows: 5, colors: 3, walls: 0, bridges: 1, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 6, rows: 6, colors: 4, walls: 2, bridges: 0, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 6, rows: 6, colors: 5, walls: 3, bridges: 1, hasBlend: false, multiColorCount: 0, tunnels: 0 },
    { cols: 7, rows: 7, colors: 5, walls: 3, bridges: 0, hasBlend: true, multiColorCount: 0, tunnels: 0 },
    { cols: 7, rows: 7, colors: 6, walls: 4, bridges: 1, hasBlend: true, multiColorCount: 0, tunnels: 0 },
    { cols: 8, rows: 8, colors: 6, walls: 4, bridges: 2, hasBlend: true, multiColorCount: 0, tunnels: 0 },
    { cols: 8, rows: 10, colors: 7, walls: 5, bridges: 2, hasBlend: true, multiColorCount: 0, tunnels: 0 },
    { cols: 8, rows: 12, colors: 7, walls: 6, bridges: 3, hasBlend: true, multiColorCount: 0, tunnels: 0 }
];

function analyzePuzzle(grid: CellData[][]) {
    let walls = 0, bridges = 0, blends = 0, multis = 0, tunnels = 0;
    grid.forEach(row => {
        row.forEach(cell => {
            if (cell.type === 'wall' || cell.type === 'block') walls++; 
            if (cell.type === 'bridge') bridges++;
            if (cell.type === 'blend') blends++;
            if (cell.isMultiColorEndpoint) multis++;
            if (cell.type === 'tunnel') tunnels++;
        });
    });
    return { rows: grid.length, cols: grid[0].length, walls, bridges, blends, multis, tunnels };
}

function getDifficultyForLevel(level: number): string {
    if (level <= 5) return 'easy';
    if (level <= 20) return 'normal';
    if (level <= 40) return 'medium';
    if (level <= 60) return 'hard';
    return 'master';
}

// 2. 1-100关的难度曲线要求
function getRequirementForLevel(level: number) {
    if (level >= 1 && level <= 5) return { r: 5, c: 5, exact: [], noWalls: true };
    if (level >= 6 && level <= 10) return { r: 5, c: 5, exact: [] };
    if (level >= 11 && level <= 20) return { r: 6, c: 6, exact: ['bridge'] };
    if (level >= 21 && level <= 30) return { r: 7, c: 7, exact: ['blend'] };
    if (level >= 31 && level <= 40) return { r: 8, c: 8, exact: ['bridge', 'blend'] };
    if (level >= 41 && level <= 60) return { r: 10, c: 8, exact: ['bridge', 'blend' ] };
    if (level >= 61 && level <= 100) return { r: 12, c: 8, exact: ['bridge', 'blend'] };
    return { r: 12, c: 8, exact: ['bridge', 'blend'] };
}

// 修复不连续的 solutionPaths：集合内所有格子都在，只是顺序错了，重新 BFS 排序
function hasValidPaths(solutionPaths: Record<number, Position[]>): boolean {
    for (const path of Object.values(solutionPaths)) {
        for (let i = 1; i < path.length; i++) {
            const dr = Math.abs(path[i].r - path[i-1].r);
            const dc = Math.abs(path[i].c - path[i-1].c);
            if (dr + dc !== 1) return false;
        }
    }
    return true;
}

function repairPaths(solutionPaths: Record<number, Position[]>, rows: number, cols: number): Record<number, Position[]> {
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const result: Record<number, Position[]> = {};
    for (const [color, path] of Object.entries(solutionPaths)) {
        // 收集属于该颜色的所有格子
        const cellSet = new Set<string>();
        for (const p of path) cellSet.add(`${p.r},${p.c}`);
        const cells = [...cellSet].map(k => {
            const [r, c] = k.split(',').map(Number);
            return { r, c };
        });
        if (cells.length < 2) { result[color] = path; continue; }

        // 找端点：集合内邻居数为 1 的格子
        const endpointCells = cells.filter(cell => {
            let neighbors = 0;
            for (const [dr, dc] of DIRS) {
                const nr = cell.r + dr, nc = cell.c + dc;
                if (cellSet.has(`${nr},${nc}`)) neighbors++;
            }
            return neighbors === 1;
        });
        if (endpointCells.length < 2) {
            // 退化为环或孤立点 — 保留原路径
            result[color] = path;
            continue;
        }

        // BFS 从第一个端点到第二个端点
        const start = endpointCells[0];
        const goal = endpointCells[1];
        const visited = new Set<string>();
        visited.add(`${start.r},${start.c}`);
        const queue: { r: number; c: number; path: Position[] }[] = [{ r: start.r, c: start.c, path: [start] }];
        let found: Position[] | null = null;
        while (queue.length > 0 && !found) {
            const cur = queue.shift()!;
            for (const [dr, dc] of DIRS) {
                const nr = cur.r + dr, nc = cur.c + dc;
                const key = `${nr},${nc}`;
                if (nr === goal.r && nc === goal.c) {
                    found = [...cur.path, { r: nr, c: nc }];
                    break;
                }
                if (cellSet.has(key) && !visited.has(key)) {
                    visited.add(key);
                    queue.push({ r: nr, c: nc, path: [...cur.path, { r: nr, c: nc }] });
                }
            }
        }
        result[color] = found || path;
    }
    return result;
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
        let bestMatch: any = undefined;
        let retries = 0;

        while (!bestMatch && retries < 200) {
            retries++;
            // 池中查找
            bestMatch = pool.find(p => {
                if (p.used) return false;
                if (p.stats.rows !== req.r || p.stats.cols !== req.c) return false;
                if (req.noWalls && p.stats.walls > 0) return false;
                if (req.exact) {
                    const hasBridge = p.stats.bridges > 0;
                    const hasBlend = p.stats.blends > 0;
                    const hasMulti = p.stats.multis > 0;
                    const hasTunnel = p.stats.tunnels > 0;
                    if (req.exact.includes('bridge') !== hasBridge) return false;
                    if (req.exact.includes('blend') !== hasBlend) return false;
                    if (req.exact.includes('multi') !== hasMulti) return false;
                    if (req.exact.includes('tunnel') !== hasTunnel) return false;
                }
                return true;
            });

            // 1-5 关：池中无匹配则即时生成
            if (!bestMatch && req.noWalls) {
                const base = POOL_TEMPLATES[Math.floor(Math.random() * 2)];
                const config: GenConfig = { ...base, colors: base.colors };
                const seed = `beginner-${i}-${Date.now()}-${retries}`;
                const result = generateCustomPuzzle(config, seed);
                if (result) {
                    const stats = analyzePuzzle(result.grid);
                    if (stats.rows === 5 && stats.cols === 5 && stats.walls === 0 &&
                        stats.bridges === 0 && stats.blends === 0 && stats.multis === 0 && stats.tunnels === 0) {
                        bestMatch = { seed, config, grid: result.grid, solutionPaths: result.solutionPaths, stats, used: true };
                    }
                }
            }

            // 6-10 关：池中无匹配则即时生成 bridge
            if (!bestMatch && req.r === 5 && req.c === 5 && req.exact?.includes('bridge')) {
                const base = POOL_TEMPLATES[2];
                const config: GenConfig = { ...base, colors: base.colors };
                const seed = `bridge-${i}-${Date.now()}-${retries}`;
                const result = generateCustomPuzzle(config, seed);
                if (result) {
                    const stats = analyzePuzzle(result.grid);
                    if (stats.rows === 5 && stats.cols === 5 && stats.bridges > 0) {
                        bestMatch = { seed, config, grid: result.grid, solutionPaths: result.solutionPaths, stats, used: true };
                    }
                }
            }

            if (!bestMatch) break; // 所有方式都找不到，跳出

            // 修复并验证
            bestMatch.solutionPaths = repairPaths(bestMatch.solutionPaths, bestMatch.stats.rows, bestMatch.stats.cols);
            if (!hasValidPaths(bestMatch.solutionPaths)) {
                bestMatch.used = true;
                bestMatch = undefined; // 循环重试下一个
            }
        }
        if (!bestMatch) {
            console.warn(`⚠️ 第 ${i} 关未找到完美匹配，启动降级匹配...`);
            const fallbacks = pool
                .filter(p => !p.used && p.stats.rows <= req.r && p.stats.cols <= req.c)
                .sort((a, b) => (b.stats.rows * b.stats.cols) - (a.stats.rows * a.stats.cols));
            bestMatch = fallbacks[0];
        }
        if (bestMatch) {
            bestMatch.used = true;

            const difficulty = getDifficultyForLevel(i);
            const seed = `${difficulty}-${bestMatch.stats.rows}x${bestMatch.stats.cols}-${i}`;

            // Type mapping: internal → output format
            const TYPE_MAP: Record<string, string> = {
                blend: 'harmony',
                wall: 'block'
            };

            // Strip r/c, map types, remap blend → harmony fields
            const grid = bestMatch.grid.map((row: CellData[]) =>
                row.map((cell: CellData) => {
                    const { r, c, ...rest } = cell;
                    const cleaned: any = { ...rest };
                    if (cleaned.connectedColors instanceof Set) {
                        cleaned.connectedColors = Array.from(cleaned.connectedColors);
                    }
                    // Map type: blend→harmony, wall→block
                    if (cleaned.type in TYPE_MAP) {
                        cleaned.type = TYPE_MAP[cleaned.type];
                    }
                    // Map blend fields → harmony fields
                    if (cleaned.blendInputs !== undefined) {
                        cleaned.colorSeq = [cleaned.blendInputs[0], cleaned.blendOutput];
                        cleaned.maxShift = 1;
                        delete cleaned.blendInputs;
                        delete cleaned.blendOutput;
                        delete cleaned.blendActivated;
                    }
                    return cleaned;
                })
            );

            // Convert solutionPaths from [{r,c},...] to [[r,c],...]
            const solutionPaths: Record<string, number[][]> = {};
            for (const [color, path] of Object.entries(bestMatch.solutionPaths)) {
                solutionPaths[color] = (path as { r: number; c: number }[]).map(p => [p.r, p.c]);
            }

            const outputData = {
                difficulty,
                seed,
                grid,
                solutionPaths,
                metadata: {
                    cols: bestMatch.config.cols,
                    rows: bestMatch.config.rows,
                    colors: bestMatch.config.colors,
                    walls: bestMatch.stats.walls,
                    bridges: bestMatch.stats.bridges,
                    hasBlend: bestMatch.config.hasBlend,
                    multiColorCount: bestMatch.config.multiColorCount,
                    tunnels: bestMatch.config.tunnels,
                    generatedAt: new Date().toISOString()
                }
            };
            fs.writeFileSync(path.join(OUTPUT_DIR, `level_${i}.json`), JSON.stringify(outputData, null, 2));
        } else {
            console.error(`❌ 严重错误：无法生成第 ${i} 关！`);
            break;
        }
    }
    console.log('🎉 1-100 关卡替换完成！');
}

buildLevels();