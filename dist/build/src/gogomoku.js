export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
const SUPPORTED_SIZES = new Set([9, 11, 13]);
const META_CACHE = new Map();
function otherPlayer(player) {
    return player === BLACK ? WHITE : BLACK;
}
function createBoardMeta(size) {
    const area = size * size;
    const neighbors4 = new Int16Array(area * 4);
    neighbors4.fill(-1);
    const xs = new Uint8Array(area);
    const ys = new Uint8Array(area);
    const centerBias = new Int16Array(area);
    const center = (size - 1) >> 1;
    const near2Buckets = Array.from({ length: area }, () => []);
    const windowsBucket = Array.from({ length: area }, () => []);
    const windows = [];
    let windowCount = 0;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const index = y * size + x;
            xs[index] = x;
            ys[index] = y;
            neighbors4[index * 4] = x > 0 ? index - 1 : -1;
            neighbors4[index * 4 + 1] = x + 1 < size ? index + 1 : -1;
            neighbors4[index * 4 + 2] = y > 0 ? index - size : -1;
            neighbors4[index * 4 + 3] = y + 1 < size ? index + size : -1;
            const manhattan = Math.abs(x - center) + Math.abs(y - center);
            centerBias[index] = size - manhattan;
            for (let ny = Math.max(0, y - 2); ny <= Math.min(size - 1, y + 2); ny += 1) {
                for (let nx = Math.max(0, x - 2); nx <= Math.min(size - 1, x + 2); nx += 1) {
                    if (nx !== x || ny !== y) {
                        near2Buckets[index].push(ny * size + nx);
                    }
                }
            }
        }
    }
    const directions = [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
    ];
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            for (let dir = 0; dir < directions.length; dir += 1) {
                const dx = directions[dir][0];
                const dy = directions[dir][1];
                const endX = x + dx * 4;
                const endY = y + dy * 4;
                if (endX < 0 || endX >= size || endY < 0 || endY >= size) {
                    continue;
                }
                const windowIndex = windowCount;
                for (let step = 0; step < 5; step += 1) {
                    const point = (y + dy * step) * size + (x + dx * step);
                    windows.push(point);
                    windowsBucket[point].push(windowIndex);
                }
                windowCount += 1;
            }
        }
    }
    let near2Total = 0;
    let windowsByPointTotal = 0;
    const near2Offsets = new Uint16Array(area + 1);
    const windowsByPointOffsets = new Uint16Array(area + 1);
    for (let i = 0; i < area; i += 1) {
        near2Offsets[i] = near2Total;
        windowsByPointOffsets[i] = windowsByPointTotal;
        near2Total += near2Buckets[i].length;
        windowsByPointTotal += windowsBucket[i].length;
    }
    near2Offsets[area] = near2Total;
    windowsByPointOffsets[area] = windowsByPointTotal;
    const near2 = new Int16Array(near2Total);
    const windowsByPoint = new Int16Array(windowsByPointTotal);
    for (let i = 0; i < area; i += 1) {
        near2.set(near2Buckets[i], near2Offsets[i]);
        windowsByPoint.set(windowsBucket[i], windowsByPointOffsets[i]);
    }
    return {
        size,
        area,
        neighbors4,
        xs,
        ys,
        near2Offsets,
        near2,
        windows: Int16Array.from(windows),
        windowCount,
        windowsByPointOffsets,
        windowsByPoint,
        centerBias,
    };
}
function getBoardMeta(size) {
    const cached = META_CACHE.get(size);
    if (cached !== undefined) {
        return cached;
    }
    const created = createBoardMeta(size);
    META_CACHE.set(size, created);
    return created;
}
function growInt16Array(current, minimumLength) {
    let nextLength = current.length === 0 ? 4 : current.length;
    while (nextLength < minimumLength) {
        nextLength <<= 1;
    }
    const next = new Int16Array(nextLength);
    next.set(current);
    return next;
}
function growUint8Array(current, minimumLength) {
    let nextLength = current.length === 0 ? 4 : current.length;
    while (nextLength < minimumLength) {
        nextLength <<= 1;
    }
    const next = new Uint8Array(nextLength);
    next.set(current);
    return next;
}
function growInt32Array(current, minimumLength) {
    let nextLength = current.length === 0 ? 4 : current.length;
    while (nextLength < minimumLength) {
        nextLength <<= 1;
    }
    const next = new Int32Array(nextLength);
    next.set(current);
    return next;
}
export class GogoPosition {
    size;
    area;
    board;
    meta;
    toMove = BLACK;
    winner = EMPTY;
    koPoint = -1;
    ply = 0;
    stoneCount = 0;
    lastMove = -1;
    lastCapturedCount = 0;
    historyMoves;
    historyPlayers;
    historyKo;
    historyWinner;
    historyCaptureStart;
    historyCaptureCount;
    capturePositions;
    captureTop = 0;
    groupVisitMarks;
    libertyMarks;
    adjacentGroupMarks;
    groupStack;
    groupBuffer;
    groupVisitEpoch = 1;
    libertyEpoch = 1;
    adjacentGroupEpoch = 1;
    scanGroupSize = 0;
    constructor(size, options = {}) {
        if (!SUPPORTED_SIZES.has(size)) {
            throw new Error(`Unsupported board size: ${size}`);
        }
        this.size = size;
        this.area = size * size;
        this.meta = getBoardMeta(size);
        this.board = new Uint8Array(this.area);
        const historyCapacity = Math.max(1, options.historyCapacity ?? this.area);
        const captureCapacity = Math.max(1, options.captureCapacity ?? this.area);
        this.historyMoves = new Int16Array(historyCapacity);
        this.historyPlayers = new Uint8Array(historyCapacity);
        this.historyKo = new Int16Array(historyCapacity);
        this.historyWinner = new Uint8Array(historyCapacity);
        this.historyCaptureStart = new Int32Array(historyCapacity);
        this.historyCaptureCount = new Int16Array(historyCapacity);
        this.capturePositions = new Int16Array(captureCapacity);
        this.groupVisitMarks = new Uint32Array(this.area);
        this.libertyMarks = new Uint32Array(this.area);
        this.adjacentGroupMarks = new Uint32Array(this.area);
        this.groupStack = new Int16Array(this.area);
        this.groupBuffer = new Int16Array(this.area);
    }
    static fromAscii(rows, toMove = BLACK, options = {}) {
        const size = rows.length;
        if (!SUPPORTED_SIZES.has(size)) {
            throw new Error(`Unsupported board size: ${size}`);
        }
        const position = new GogoPosition(size, options);
        position.toMove = toMove;
        for (let y = 0; y < size; y += 1) {
            const row = rows[y];
            if (row.length !== size) {
                throw new Error(`Row ${y} has invalid width ${row.length}, expected ${size}`);
            }
            for (let x = 0; x < size; x += 1) {
                const symbol = row[x];
                const index = y * size + x;
                if (symbol === '.' || symbol === '+') {
                    continue;
                }
                if (symbol === 'X' || symbol === 'x' || symbol === 'B' || symbol === 'b') {
                    position.board[index] = BLACK;
                    position.stoneCount += 1;
                    continue;
                }
                if (symbol === 'O' || symbol === 'o' || symbol === 'W' || symbol === 'w') {
                    position.board[index] = WHITE;
                    position.stoneCount += 1;
                    continue;
                }
                throw new Error(`Unsupported board symbol: ${symbol}`);
            }
        }
        position.winner = position.detectExistingWinner();
        return position;
    }
    index(x, y) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) {
            return -1;
        }
        return y * this.size + x;
    }
    at(x, y) {
        const index = this.index(x, y);
        return index === -1 ? EMPTY : this.board[index];
    }
    playXY(x, y) {
        const index = this.index(x, y);
        return index !== -1 && this.play(index);
    }
    isLegal(index) {
        const legal = this.play(index);
        if (legal) {
            this.undo();
        }
        return legal;
    }
    hasAnyLegalMove() {
        if (this.winner !== EMPTY) {
            return false;
        }
        for (let index = 0; index < this.area; index += 1) {
            if (this.board[index] === EMPTY && this.isLegal(index)) {
                return true;
            }
        }
        return false;
    }
    generateAllLegalMoves(buffer) {
        if (this.winner !== EMPTY) {
            return 0;
        }
        let count = 0;
        for (let index = 0; index < this.area; index += 1) {
            if (this.board[index] === EMPTY && this.isLegal(index)) {
                buffer[count] = index;
                count += 1;
            }
        }
        return count;
    }
    play(index) {
        if (this.winner !== EMPTY ||
            index < 0 ||
            index >= this.area ||
            this.board[index] !== EMPTY ||
            index === this.koPoint) {
            return false;
        }
        this.ensureHistoryCapacity(this.ply + 1);
        const player = this.toMove;
        const opponent = otherPlayer(player);
        const captureStart = this.captureTop;
        let capturedCount = 0;
        this.board[index] = player;
        this.stoneCount += 1;
        const neighbors = this.meta.neighbors4;
        const neighborBase = index * 4;
        this.adjacentGroupEpoch += 1;
        for (let offset = 0; offset < 4; offset += 1) {
            const neighbor = neighbors[neighborBase + offset];
            if (neighbor === -1 || this.board[neighbor] !== opponent || this.adjacentGroupMarks[neighbor] === this.adjacentGroupEpoch) {
                continue;
            }
            const liberties = this.scanGroup(neighbor, opponent);
            for (let groupIndex = 0; groupIndex < this.scanGroupSize; groupIndex += 1) {
                this.adjacentGroupMarks[this.groupBuffer[groupIndex]] = this.adjacentGroupEpoch;
            }
            if (liberties !== 0) {
                continue;
            }
            this.ensureCaptureCapacity(this.captureTop + this.scanGroupSize);
            for (let groupIndex = 0; groupIndex < this.scanGroupSize; groupIndex += 1) {
                const point = this.groupBuffer[groupIndex];
                this.capturePositions[this.captureTop] = point;
                this.captureTop += 1;
                this.board[point] = EMPTY;
            }
            capturedCount += this.scanGroupSize;
            this.stoneCount -= this.scanGroupSize;
        }
        const madeFive = this.checkFiveFrom(index, player);
        const ownLiberties = this.scanGroup(index, player);
        const ownGroupSize = this.scanGroupSize;
        if (ownLiberties === 0 && !madeFive) {
            this.rollbackIllegalMove(index, opponent, captureStart, capturedCount);
            return false;
        }
        let nextKo = -1;
        if (!madeFive && capturedCount === 1 && ownGroupSize === 1 && ownLiberties === 1) {
            nextKo = this.capturePositions[captureStart];
        }
        this.historyMoves[this.ply] = index;
        this.historyPlayers[this.ply] = player;
        this.historyKo[this.ply] = this.koPoint;
        this.historyWinner[this.ply] = this.winner;
        this.historyCaptureStart[this.ply] = captureStart;
        this.historyCaptureCount[this.ply] = capturedCount;
        this.ply += 1;
        this.koPoint = nextKo;
        this.toMove = opponent;
        this.winner = madeFive ? player : EMPTY;
        this.lastMove = index;
        this.lastCapturedCount = capturedCount;
        return true;
    }
    undo() {
        if (this.ply === 0) {
            return false;
        }
        this.ply -= 1;
        const index = this.historyMoves[this.ply];
        const player = this.historyPlayers[this.ply];
        const opponent = otherPlayer(player);
        const captureStart = this.historyCaptureStart[this.ply];
        const captureCount = this.historyCaptureCount[this.ply];
        this.board[index] = EMPTY;
        this.stoneCount -= 1;
        for (let i = 0; i < captureCount; i += 1) {
            const point = this.capturePositions[captureStart + i];
            this.board[point] = opponent;
        }
        this.stoneCount += captureCount;
        this.captureTop = captureStart;
        this.toMove = player;
        this.koPoint = this.historyKo[this.ply];
        this.winner = this.historyWinner[this.ply];
        this.lastMove = this.ply === 0 ? -1 : this.historyMoves[this.ply - 1];
        this.lastCapturedCount = this.ply === 0 ? 0 : this.historyCaptureCount[this.ply - 1];
        return true;
    }
    scanGroup(start, color) {
        this.groupVisitEpoch += 1;
        this.libertyEpoch += 1;
        const visitEpoch = this.groupVisitEpoch;
        const libertyEpoch = this.libertyEpoch;
        const stack = this.groupStack;
        const buffer = this.groupBuffer;
        const board = this.board;
        const neighbors = this.meta.neighbors4;
        let stackSize = 0;
        let bufferSize = 0;
        let liberties = 0;
        stack[stackSize] = start;
        stackSize += 1;
        this.groupVisitMarks[start] = visitEpoch;
        while (stackSize !== 0) {
            stackSize -= 1;
            const point = stack[stackSize];
            buffer[bufferSize] = point;
            bufferSize += 1;
            const neighborBase = point * 4;
            for (let offset = 0; offset < 4; offset += 1) {
                const neighbor = neighbors[neighborBase + offset];
                if (neighbor === -1) {
                    continue;
                }
                const cell = board[neighbor];
                if (cell === EMPTY) {
                    if (this.libertyMarks[neighbor] !== libertyEpoch) {
                        this.libertyMarks[neighbor] = libertyEpoch;
                        liberties += 1;
                    }
                }
                else if (cell === color && this.groupVisitMarks[neighbor] !== visitEpoch) {
                    this.groupVisitMarks[neighbor] = visitEpoch;
                    stack[stackSize] = neighbor;
                    stackSize += 1;
                }
            }
        }
        this.scanGroupSize = bufferSize;
        return liberties;
    }
    detectExistingWinner() {
        const windows = this.meta.windows;
        for (let windowIndex = 0; windowIndex < this.meta.windowCount; windowIndex += 1) {
            const base = windowIndex * 5;
            const first = this.board[windows[base]];
            if (first === EMPTY) {
                continue;
            }
            let allEqual = true;
            for (let step = 1; step < 5; step += 1) {
                if (this.board[windows[base + step]] !== first) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                return first;
            }
        }
        return EMPTY;
    }
    ensureHistoryCapacity(minimumLength) {
        if (minimumLength <= this.historyMoves.length) {
            return;
        }
        this.historyMoves = growInt16Array(this.historyMoves, minimumLength);
        this.historyPlayers = growUint8Array(this.historyPlayers, minimumLength);
        this.historyKo = growInt16Array(this.historyKo, minimumLength);
        this.historyWinner = growUint8Array(this.historyWinner, minimumLength);
        this.historyCaptureStart = growInt32Array(this.historyCaptureStart, minimumLength);
        this.historyCaptureCount = growInt16Array(this.historyCaptureCount, minimumLength);
    }
    ensureCaptureCapacity(minimumLength) {
        if (minimumLength <= this.capturePositions.length) {
            return;
        }
        this.capturePositions = growInt16Array(this.capturePositions, minimumLength);
    }
    rollbackIllegalMove(index, opponent, captureStart, capturedCount) {
        this.board[index] = EMPTY;
        this.stoneCount -= 1;
        for (let i = captureStart; i < this.captureTop; i += 1) {
            const point = this.capturePositions[i];
            this.board[point] = opponent;
        }
        this.stoneCount += capturedCount;
        this.captureTop = captureStart;
    }
    checkFiveFrom(index, color) {
        const x = this.meta.xs[index];
        const y = this.meta.ys[index];
        const size = this.size;
        const directions = [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
        ];
        for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
            const dx = directions[directionIndex][0];
            const dy = directions[directionIndex][1];
            let count = 1;
            let nx = x + dx;
            let ny = y + dy;
            while (nx >= 0 && nx < size && ny >= 0 && ny < size && this.board[ny * size + nx] === color) {
                count += 1;
                nx += dx;
                ny += dy;
            }
            nx = x - dx;
            ny = y - dy;
            while (nx >= 0 && nx < size && ny >= 0 && ny < size && this.board[ny * size + nx] === color) {
                count += 1;
                nx -= dx;
                ny -= dy;
            }
            if (count >= 5) {
                return true;
            }
        }
        return false;
    }
}
export function playerName(player) {
    return player === BLACK ? 'black' : 'white';
}
