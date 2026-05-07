# 星轨消消乐

一个为微信移动端优化的 H5 消消乐小游戏。玩法不是交换相邻棋子，而是滑动整行或整列，让星星循环位移，凑出三连以上的能量链。

## 创意玩法

- 整行 / 整列旋转：横滑移动当前行，竖滑移动当前列。
- 星愿目标：右上角会指定一种星星，完成星愿可获得额外能量。
- 光环星星：带光环的星星被消除时，会引爆所在行和列。
- 连锁奖励：连续坍塌产生的连锁越多，分数越高。

## 本地打开

直接用浏览器打开：

```text
match3/index.html
```

也可以在仓库根目录启动静态服务：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

## 上传到 GitHub 后让微信打开

1. 把仓库推送到 GitHub。
2. 进入仓库的 `Settings` -> `Pages`。
3. `Build and deployment` 选择 `Deploy from a branch`。
4. `Branch` 选择 `main`，目录选择 `/root`。
5. 发布后访问 GitHub Pages 地址，例如：

```text
https://你的用户名.github.io/仓库名/
```

根目录 `index.html` 会自动跳转到 `match3/`，所以把这个 GitHub Pages 链接发到微信里即可打开游戏。

## 文件说明

- `index.html`：GitHub Pages 根入口，会跳转到游戏。
- `match3/index.html`：完整 H5 游戏，适配微信内置浏览器。
- `wechat-minigame/`：微信小游戏工程目录，和 H5 页面独立。
