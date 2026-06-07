const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- ゲームロジック用ユーティリティ ---
function rand(val) { return Math.floor(Math.random() * val - val / 2); }

class Vec3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class Model {
    constructor(data) {
        this.data = data;
        this.work = data.map(v => v.map(p => new Vec3(p.x, p.y, p.z)));
    }
    init() {
        for (let i = 0; i < this.work.length; i++) {
            for (let j = 0; j < this.work[i].length; j++) {
                this.work[i][j].x = this.data[i][j].x;
                this.work[i][j].y = this.data[i][j].y;
                this.work[i][j].z = this.data[i][j].z;
            }
        }
    }
    apply(m) {
        for (let i = 0; i < this.work.length; i++) {
            for (let j = 0; j < this.work[i].length; j++) {
                let v = this.work[i][j];
                let x = m[0] * v.x + m[1] * v.y + m[2] * v.z;
                let y = m[3] * v.x + m[4] * v.y + m[5] * v.z;
                let z = m[6] * v.x + m[7] * v.y + m[8] * v.z;
                v.x = x; v.y = y; v.z = z;
            }
        }
    }
    translate(x, y, z) {
        for (let i = 0; i < this.work.length; i++) {
            for (let j = 0; j < this.work[i].length; j++) {
                this.work[i][j].x += x;
                this.work[i][j].y += y;
                this.work[i][j].z += z;
            }
        }
    }
}

function createMatrixY(radian) {
    const c = Math.cos(radian);
    const s = Math.sin(radian);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
}

// --- ゲームオブジェクト群 ---
class Shot {
    constructor(id, x, z, dir) {
        this.id = id;
        this.type = 'shot';
        this.x = x;
        this.z = z;
        this.dx = -Math.sin(dir) * 5;
        this.dz = Math.cos(dir) * 5;
        this.count = 0;
        this.model = new Model([[
            new Vec3(x, -5, z),
            new Vec3(x + this.dx, -5, z + this.dz)
        ]]);
    }
    update() {
        this.model.init();
        this.count++;
        this.model.translate(this.dx * this.count, 0, this.dz * this.count);
    }
    isValid() { return this.count < 30; }
    getX() { return this.x + this.dx * this.count; }
    getZ() { return this.z + this.dz * this.count; }
    getColor() { return "#FFFFFF"; }
}

class Tank {
    constructor(id, isNPC = false) {
        this.id = id;
        this.type = 'tank';
        this.isNPC = isNPC;
        this.valid = true;
        
        const v = [
            new Vec3(-10, -5, -5), new Vec3(-10, -5, +5),
            new Vec3(10, -5, 0), new Vec3(-8, 2, 0)
        ];
        const polygon = [
            [v[0], v[1], v[2]], [v[0], v[1], v[3]],
            [v[1], v[2], v[3]], [v[2], v[0], v[3]]
        ];
        this.model = new Model(polygon);

        // プレイヤー情報、またはNPCの初期移動設定
        this.x = rand(400);
        this.z = rand(400);
        this.theta = 0;

        if (this.isNPC) {
            this.setDestination();
        }
    }
    setDestination(x, z, t) {
        this.x = x || rand(400);
        this.z = z || rand(400);
        this.t = t || 0;
        this.nx = rand(400);
        this.nz = rand(400);
        this.nt = -Math.atan2(this.nz - this.z, this.nx - this.x);
        this.count = 0;
        this.rotating = true;
        this.matrix = createMatrixY(this.nt);
    }
    getX() {
        if (!this.isNPC) return this.x;
        return this.x + (this.rotating ? 0 : (this.nx - this.x) * this.count / 100);
    }
    getZ() {
        if (!this.isNPC) return this.z;
        return this.z + (this.rotating ? 0 : (this.nz - this.z) * this.count / 100);
    }
    getColor() { return this.isNPC ? "#00FF00" : "#0088FF"; }
    isValid() { return this.valid; }
    
    update() {
        this.model.init();
        if (this.isNPC) {
            this.count++;
            if (this.rotating) {
                this.theta = (this.nt - this.t) * this.count / 20 + this.t;
                if (this.count > 20) {
                    this.rotating = false;
                    this.count = 0;
                }
            } else {
                this.theta = this.nt;
            }
            this.matrix = createMatrixY(this.theta);
            if (this.count > 100) {
                this.setDestination(this.nx, this.nz, this.nt);
            }
        } else {
            this.matrix = createMatrixY(this.theta);
        }
        this.model.apply(this.matrix);
        this.model.translate(this.getX(), 0, this.getZ());
    }
}

class Bang {
    constructor(tank) {
        this.type = 'bang';
        this.count = 0;
        
        // 元の戦車の位置から安全に破片を生成
        const wx = tank.getX();
        const wz = tank.getZ();
        const polygon = [
            [new Vec3(wx-5, -5, wz-5), new Vec3(wx+5, -5, wz+5)],
            [new Vec3(wx+5, -5, wz-5), new Vec3(wx-5, -5, wz+5)]
        ];
        this.model = new Model(polygon);
        
        this.colors = Array.from({length: 16}, (_, i) => `#0${(15-i).toString(16)}0`);
        this.r = Array.from({length: 4}, () => new Vec3(rand(20), rand(20), rand(20)));
    }
    update() {
        this.model.init();
        this.count++;
        let index = 0;
        for (let i = 0; i < this.model.work.length; i++) {
            for (let j = 0; j < this.model.work[i].length; j++) {
                this.model.work[i][j].x += (this.r[index].x) * this.count / 16;
                this.model.work[i][j].y += (this.r[index].y) * this.count / 16;
                this.model.work[i][j].z += (this.r[index].z) * this.count / 16;
                index++;
            }
        }
    }
    isValid() { return this.count < 16; }
    getColor() { return this.colors[this.count] || "#000000"; }
}

// 固定の床（タイル）オブジェクト
const tileModel = (() => {
    let polygon = [];
    for (let x = -200; x < 200; x += 10) {
        for (let z = -200; z < 200; z += 10) {
            polygon.push([
                new Vec3(x, -5, z), new Vec3(x + 10, -5, z),
                new Vec3(x + 10, -5, z + 10), new Vec3(x, -5, z + 10),
            ]);
        }
    }
    return new Model(polygon);
})();

// --- ゲーム状態管理 ---
let clients = {}; // 接続中のプレイヤー
let npcs = [];    // 敵NPC
let shots = [];   // 弾
let effects = []; // 爆発エフェクト

// NPCの初期化
for (let i = 0; i < 4; i++) {
    npcs.push(new Tank(`npc_${i}`, true));
}

// メインゲームループ (100ms 毎)
setInterval(() => {
    // 弾の更新
    shots.forEach(s => s.update());
    // NPCの更新
    npcs.forEach(n => n.update());
    // エフェクトの更新
    effects.forEach(e => e.update());

    // 当たり判定 (NPC vs 弾)
    for (let n of npcs) {
        for (let s of shots) {
            let dx = Math.abs(n.getX() - s.getX());
            let dz = Math.abs(n.getZ() - s.getZ());
            if (dx < 15 && dz < 15 && n.valid) {
                n.valid = false;
                effects.push(new Bang(n));
                io.emit('sound', 'bang'); // 全員に音再生を通知
                
                // NPCのリスポーン
                setTimeout(() => {
                    const idx = npcs.indexOf(n);
                    if(idx !== -1) npcs[idx] = new Tank(n.id, true);
                }, 2000);
            }
        }
    }

    // フィルター処理
    shots = shots.filter(s => s.isValid());
    effects = effects.filter(e => e.isValid());

    // 全クライアントに状態を配信
    const gameState = {
        players: Object.values(clients).map(p => ({ id: p.id, x: p.x, z: p.z, theta: p.theta, model: p.model, color: p.getColor() })),
        npcs: npcs.filter(n => n.valid).map(n => ({ id: n.id, x: n.getX(), z: n.getZ(), theta: n.theta, model: n.model, color: n.getColor() })),
        shots: shots.map(s => ({ x: s.getX(), z: s.getZ(), model: s.model, color: s.getColor() })),
        effects: effects.map(e => ({ model: e.model, color: e.getColor() }))
    };
    io.emit('update', gameState);
}, 100);

// 通信ハンドリング
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    clients[socket.id] = new Tank(socket.id, false);

    // 初期位置送信
    socket.emit('init', { id: socket.id });

    // クライアントからの操作受信
    socket.on('move', (data) => {
        const player = clients[socket.id];
        if (!player) return;
        player.x = data.x;
        player.z = data.z;
        player.theta = data.theta;
        player.update();
    });

    socket.on('shoot', (data) => {
        shots.push(new Shot(socket.id, data.x, data.z, data.theta));
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete clients[socket.id];
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});