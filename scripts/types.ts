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
    Blend = 'blend',
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
