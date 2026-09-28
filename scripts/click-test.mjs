/**
 * 无头浏览器端到端验证。
 *
 * 本地起一个同源小服务：既托管测试页面，也把请求转发给贴吧接口
 * （浏览器里直接 fetch tiebac 会被 CORS 挡住，转发绕开这一点）。
 * 于是面板可以用**真实数据**渲染，从而对排版做真实测量。
 *
 * 用假 BDUSS：proto 接口（getProfile / getUserPost）本来就不携带 BDUSS。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

/** 可用 EZTB_BUNDLE 指定其它产物做反向验证。 */
const bundlePath =
	process.env.EZTB_BUNDLE ??
	path.join(projectRoot, "dist/tieba-eztb-toolbox.user.js");
const bundle = fs.readFileSync(bundlePath, "utf8");
console.log(`被测产物：${path.relative(projectRoot, bundlePath)}`);

/** 真实存在、且同时有主题帖 / 回复 / 楼中楼的用户，用于让面板拉到真实数据 */
const TEST_USER_ID = "1941147376";

/**
 * 主题帖超过一页的用户（贴吧用户发帖 feed 每页 60 条，这个用户第 1、2 页都满），
 * 用来验证「主题帖」子页签的「加载更多」真的会翻页。
 */
const PAGER_USER_ID = "3408054413";
const PAGER_FIRST_PAGE = 60;

/**
 * 测试用户隐藏了关注贴吧，只能从 profile / 用户面板恢复。
 * 他的恢复结果里有「小红书」这个吧（scripts/live-test.mjs 可复现），
 * 用它当关注的吧关键词，验证"隐藏的关注也能参与成分判定"。
 */
const HIDDEN_FORUM_KEYWORD = "小红书";

/**
 * 「发帖记录被隐藏」这条路没法依赖真实账号：对方随时可能改隐私设置，测试就会变红。
 * 所以额外放一个测试用户，只把**他的 userpost 请求**用一段手工构造的 protobuf 顶掉：
 * `{ data: { hidePost: 1 } }` 的字节是 `0x12 0x02 0x10 0x01`
 * （用 SDK 的 UserPostResIdl.decode 验证过：hidePost=1、postList 为空；
 * 真实链路上 hidePost=1 的账号返回的也正是这个形状，见 scripts/live-test.mjs 的断言）。
 * 其它请求（资料、关注吧）仍然走真实接口。
 */
const HIDDEN_STUB_USER_ID = "2724733822";
const HIDDEN_STUB_BYTES = Buffer.from([0x12, 0x02, 0x10, 0x01]);

/**
 * 请求体里找 user id 不能用 ASCII：proto 里的 userId 是 int64，走的是 varint 编码。
 * （一开始按字符串匹配，桩一次都没命中，实测才发现。）
 */
function varintBytes(value) {
	const bytes = [];
	let rest = BigInt(value);
	while (rest > 127n) {
		bytes.push(Number((rest & 127n) | 128n));
		rest >>= 7n;
	}
	bytes.push(Number(rest));
	return Buffer.from(bytes);
}
const HIDDEN_STUB_NEEDLE = varintBytes(HIDDEN_STUB_USER_ID);

const BROWSERS = [
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
if (!browser) {
	console.error("找不到 Edge 或 Chrome");
	process.exit(1);
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>eztb test</title></head>
<body>
<div id="wrap">
  <div class="l_post" data-field='{"author":{"user_id":${TEST_USER_ID},"user_name":"%E6%B5%8B%E8%AF%95","portrait":"tb.1.abc123"}}'>
    <div class="d_author"><a class="p_author_name" href="/home/main?id=tb.1.abc123">旧版作者</a></div>
  </div>
  <div class="head-line">
    <a class="name-info-link" href="/home/main?id=tb.1.def456">新版</a>
    <span class="head-name">新版昵称</span>
    <div class="btn-wrapper" style="pointer-events:none"><a href="#">回复</a></div>
  </div>
  <div class="l_post" id="pager-post" data-field='{"author":{"user_id":${PAGER_USER_ID},"user_name":"%E7%BF%BB%E9%A1%B5","portrait":"tb.1.pager"}}'>
    <div class="d_author"><a class="p_author_name" href="/home/main?id=tb.1.pager">翻页用户</a></div>
  </div>
  <div class="l_post" id="hidden-post" data-field='{"author":{"user_id":${HIDDEN_STUB_USER_ID},"user_name":"%E9%9A%90%E8%97%8F","portrait":"tb.1.hidden"}}'>
    <div class="d_author"><a class="p_author_name" href="/home/main?id=tb.1.hidden">隐藏发帖用户</a></div>
  </div>
</div>
<script>
  // ── 油猴 API 桩：请求经本地代理转发到贴吧 ──
  var __store = { tbEztbToolboxSettingsV1: {
    bduss: 'TEST_DUMMY_BDUSS',
    // 成分检测：用「直接命中名单」这条规则，命中判定不依赖对方的数据，测试才稳定。
    // 注意这里只放一行——字符串里的换行要写成 \\n 才不会把页面脚本写坏。
    compositionRules: '⚠️测试名单 | | | | ${TEST_USER_ID}\\n🧪隐藏关注 | | ${HIDDEN_FORUM_KEYWORD}',
    compositionAuto: true,
    compositionMaxPerPage: 5,
    compositionCacheDays: 1
  } };
  window.GM_getValue = function (k, d) { return (k in __store) ? __store[k] : d; };
  window.GM_setValue = function (k, v) { __store[k] = v; };
  // 菜单命令留个钩子：测试要能触发"重新检测本页用户"这类入口
  window.__tbMenus = {};
  window.GM_registerMenuCommand = function (label, fn) { window.__tbMenus[label] = fn; return 1; };
  // alert 在无头浏览器里会把页面卡住，这里拦下来只做记录
  window.__tbAlerts = [];
  window.alert = function (text) { window.__tbAlerts.push(String(text)); };
  window.__tbRequests = 0;
  // 请求日志：定位"哪个请求发出去了但一直没回来"（桩/代理层的问题都靠它）
  window.__tbLog = [];
  window.GM_xmlhttpRequest = function (d) {
    window.__tbRequests++;
    var entry = { url: d.url, state: 'start' };
    window.__tbLog.push(entry);
    fetch('/proxy?u=' + encodeURIComponent(d.url), {
      method: d.method || 'GET',
      headers: d.headers || {},
      body: d.data || undefined
    }).then(function (res) {
      return res.arrayBuffer().then(function (buf) {
        entry.state = 'done:' + res.status + ':' + buf.byteLength;
        d.onload && d.onload({ status: res.status, statusText: res.statusText, responseHeaders: '', response: buf });
      });
    }).catch(function (e) { entry.state = 'error:' + e; d.onerror && d.onerror({}); });
    return { abort: function () {} };
  };
  window.__tbErrors = [];
  window.addEventListener('error', function (e) { window.__tbErrors.push(String(e.message)); });
  console.log = function () {};
</script>
<script>${bundle}</script>
<script>
  var lines = [];
  function add(label, ok, detail) {
    lines.push((ok ? 'PASS' : 'FAIL') + '|' + label + '|' + (detail === undefined ? '' : String(detail)));
  }
  function hitTest(el) {
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { ok: false, why: 'zero-size' };
    var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: hit === el || el.contains(hit), why: hit ? (hit.tagName + ':' + (hit.className || '')) : 'null' };
  }
  function until(test, done, giveUp) {
    var tries = 0;
    (function poll() {
      if (test()) return done(true);
      if (++tries > (giveUp || 100)) return done(false);
      setTimeout(poll, 200);
    })();
  }
  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    fetch('/result', { method: 'POST', body: 'TBSTART\\n' + lines.join('\\n') + '\\nTBEND' }).catch(function () {});
  }
  function rect(el) { return el ? el.getBoundingClientRect() : null; }
  function visible(el) { return !!el && el.getBoundingClientRect().height > 0; }
  function visiblePanes() {
    return Array.prototype.filter.call(
      document.querySelectorAll('.tb-eztb-pane'),
      function (p) { return p.getBoundingClientRect().height > 0; }
    );
  }
  // 「发帖」页签拆成了两个子页签：主题帖 / 回复，各自独立分页
  /**
   * 取**最新那个**面板里的元素。

   * 页面上可能同时存在多个面板（点开新的会先关掉旧的，但旧的 DOM 在同一帧里还在），
   * 用 querySelector 会命中最早的那个，断言就会看着像"新面板没生效"。
   */
  function lastMask() {
    var masks = document.querySelectorAll('.tb-eztb-mask');
    return masks.length ? masks[masks.length - 1] : null;
  }
  function inPanel(selector) {
    var scope = lastMask() || document;
    return scope.querySelector(selector);
  }
  function postsPane() { return inPanel('.tb-eztb-pane[data-pane="posts"]'); }
  function subPane(name) {
    var root = postsPane();
    return root ? root.querySelector('.tb-eztb-subpane[data-subpane="' + name + '"]') : null;
  }
  /**
   * 这一路 feed 的第一批数据到齐了吗（还是页脚写着「正在加载…」）。

   * 回复那一路比主题帖慢（要先按吧反查吧名），所以「翻页只影响主题帖子页签」这类
   * 断言必须先等两路都停稳再记基线：否则"回复正在陆续到"会被误判成"翻页影响了回复区"。
   * （2026-09-27：把回复那一路的耗时从 8.5 秒压到 1.8 秒之后，这条断言立刻变红——
   *  它以前一直是靠"回复还没到"才通过的。）
   */
  function subPaneSettled(name) {
    var pane = subPane(name);
    if (!pane) return true;
    var hint = pane.querySelector('.tb-eztb-hint');
    return !hint || String(hint.textContent).indexOf('正在加载') < 0;
  }
  function rowsIn(el) { return el ? el.querySelectorAll('.tb-eztb-row') : []; }
  function moreIn(el) { return el ? el.querySelector('.tb-eztb-more') : null; }
  function kindCounts(el) {
    var kinds = {};
    Array.prototype.forEach.call(el ? el.querySelectorAll('.tb-eztb-tag') : [], function (tag) {
      kinds[tag.textContent] = (kinds[tag.textContent] || 0) + 1;
    });
    return kinds;
  }
  function visibleSubPanes() {
    return Array.prototype.filter.call(
      document.querySelectorAll('.tb-eztb-pane[data-pane="posts"] .tb-eztb-subpane'),
      function (p) { return p.getBoundingClientRect().height > 0; }
    );
  }

  /**
   * 回复行的"正文"：副标题里扣掉吧名小标签与楼中楼的「↩ 谁」之后剩下的文字。
   * 直接量整段 textContent 会把标签也算进正文，断言就变得很宽。
   */
  function rowBodyText(row) {
    var sub = row.querySelector('.tb-eztb-row-sub');
    if (!sub) return '';
    var text = String(sub.textContent);
    Array.prototype.forEach.call(
      sub.querySelectorAll('.tb-eztb-row-forum,.tb-eztb-row-replyto'),
      function (chip) { text = text.split(chip.textContent).join(''); }
    );
    return text.replace(/\\s+/g, '');
  }

  /** 对某个子页签的列表做排版断言（只看这一个子页签，避免串台） */
  function checkLayout(scope, label) {
    var rows = rowsIn(scope);
    add(label + '渲染出真实记录', rows.length > 0, '共 ' + rows.length + ' 行');
    if (!rows.length) return;

    // 类型标签：主题 / 回复 / 楼中楼
    var tags = scope.querySelectorAll('.tb-eztb-tag');
    var kinds = kindCounts(scope);
    add(label + '每条记录都有类型标签', tags.length === rows.length,
        '标签 ' + tags.length + ' / 行 ' + rows.length + ' ' + JSON.stringify(kinds));

    var row = rows[0];
    var rowRect = row.getBoundingClientRect();
    var titleRect = rect(row.querySelector('.tb-eztb-row-title'));
    var subRect = rect(row.querySelector('.tb-eztb-row-sub'));
    var metaRect = rect(row.querySelector('.tb-eztb-row-meta'));

    // 关键断言：标题与副标题都是块级行，左右边界应与所属列完全对齐。
    // 行内元素时副标题会收缩成内容的宽度（曾测到 sub.right 从 599.9 塌到 86.0），
    // 且短标题时会与标题挤在同一行。
    add(label + '标题与副标题各占一整行（左右边界与列对齐）',
        !!(titleRect && subRect) &&
          Math.abs(subRect.left - titleRect.left) < 1.5 &&
          Math.abs(subRect.right - titleRect.right) < 1.5,
        titleRect && subRect
          ? ('title=[' + titleRect.left.toFixed(1) + ',' + titleRect.right.toFixed(1) + '] sub=[' + subRect.left.toFixed(1) + ',' + subRect.right.toFixed(1) + ']')
          : '缺少元素');
    add(label + '标题在副标题上方（不同行）',
        !!(titleRect && subRect) ? subRect.top >= titleRect.bottom - 1 : false,
        titleRect && subRect ? ('title.bottom=' + titleRect.bottom.toFixed(1) + ' sub.top=' + subRect.top.toFixed(1)) : '缺少元素');
    add(label + '标题不溢出行的右边界',
        !!titleRect && titleRect.right <= rowRect.right + 1,
        titleRect ? ('title.right=' + titleRect.right.toFixed(1) + ' row.right=' + rowRect.right.toFixed(1)) : '');
    add(label + '行内无水平溢出',
        row.scrollWidth <= row.clientWidth + 1,
        'scrollWidth=' + row.scrollWidth + ' clientWidth=' + row.clientWidth);
    add(label + '副标题不侵入右侧时间列',
        !!(subRect && metaRect) ? subRect.right <= metaRect.left + 1 : true,
        subRect && metaRect ? ('sub.right=' + subRect.right.toFixed(1) + ' meta.left=' + metaRect.left.toFixed(1)) : '无');
    add(label + '同一列表内各行高度一致',
        rows.length < 2 || Math.abs(rows[0].getBoundingClientRect().height - rows[1].getBoundingClientRect().height) < 1.5,
        rows.length >= 2 ? ('h0=' + rows[0].getBoundingClientRect().height.toFixed(1) + ' h1=' + rows[1].getBoundingClientRect().height.toFixed(1)) : '单行');
  }

  /**
   * 阶段 5：换一个「主题帖超过一页」的用户，验证「加载更多」真的会翻页。
   * 上面那位用户两条 feed 都只有一页，翻页断言会退化成空转，这里补齐。
   */
  function phasePaging() {
    var pagerBtn = document.querySelector('#pager-post .tb-eztb-btn');
    add('翻页用用户也注入了按钮', !!pagerBtn, '');
    if (!pagerBtn) {
      add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
      finish();
      return;
    }
    pagerBtn.click();
    until(function () {
      // 新面板要先把用户解析出来，页签才可点
      return !!document.querySelector('.tb-eztb-kv') && !!document.querySelector('.tb-eztb-tab[data-tab="posts"]');
    }, function (ready) {
      add('翻页用用户的面板已打开并解析出资料', ready, '');
      // 用 inPanel 取**最新那个**面板里的页签（页面上可能残留旧面板的 DOM）
      var pagerPostsTab = inPanel('.tb-eztb-tab[data-tab="posts"]');
      if (!ready || !pagerPostsTab) {
        add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
        finish();
        return;
      }
      pagerPostsTab.click();
      // 点开的这一瞬间两路 feed 都还在路上（loadNext 是异步的），饼图必须写明
      // 「数据还在加载」——用户 2026-09-27 报的"有时只统计了发帖的数据"就是这个
      // 中间态被当成了结果。这一条是**同步**断言，不依赖网速，所以不会 flaky。
      var pendingOnEntry = inPanel('.tb-eztb-pie-pending');
      add('初次点进时饼图标注「数据还在加载 / 还不完整」（不把只有主题帖的图画成完整的）',
          !!pendingOnEntry, pendingOnEntry ? String(pendingOnEntry.textContent).slice(0, 46) : '没找到');
      until(function () {
        // 两路都要停稳：下面要拿"回复区的行数"当基线，回复那一路还在加载的话基线就是错的
        // 判据用饼图旁边那条"数据还在加载"提示：它只在两路首批都到齐（或失败）后消失。
        // （不要用 subPaneSettled：还没开始加载的子页签也满足"没有正在加载"，会取到 0 行当基线）
        return rowsIn(subPane('topic')).length >= ${PAGER_FIRST_PAGE} &&
          !inPanel('.tb-eztb-pie-pending');
      }, function (ok) {
        var before = rowsIn(subPane('topic')).length;
        add('翻页用用户的第一页主题帖已加载', ok, before + ' 行');
        if (!before) {
          add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
          finish();
          return;
        }
        var replyBefore = rowsIn(subPane('reply')).length;
        moreIn(subPane('topic')).click();
        until(function () {
          var btn = moreIn(subPane('topic'));
          return !btn || !btn.disabled;
        }, function () {
          var after = rowsIn(subPane('topic')).length;
          add('「主题帖」子页签的「加载更多」真的取到了下一页',
              after > before, before + ' → ' + after + ' 行');
          add('翻页只影响「主题帖」子页签',
              rowsIn(subPane('reply')).length === replyBefore && visibleSubPanes().length === 1,
              '回复区 ' + rowsIn(subPane('reply')).length + ' 行 / 可见子页签 ' + visibleSubPanes().length + ' 个');
          add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
          phaseBadges();
        }, 200);
      }, 200);
    }, 100);
  }

  /**
   * 阶段 8：这一轮新增的功能——占比饼图、回复正文与「查楼层」、签到号检测，
   * 以及"对方隐藏了发帖记录"时的说辞。
   *
   * 拆成几个小函数串起来，省得再嵌五层回调（前面几个阶段已经够深了）。
   */
  function phaseExtras() {
    var postsTab = inPanel('.tb-eztb-tab[data-tab="posts"]');
    add('（阶段 8）面板仍开着，可以继续看发帖页签', !!postsTab,
        '遮罩 ' + document.querySelectorAll('.tb-eztb-mask').length + ' 个');
    if (!postsTab) { extrasSignIn(); return; }
    postsTab.click();
    until(function () { return rowsIn(subPane('topic')).length > 0; }, function (ok) {
      add('阶段 8：主题帖重新加载出来了', ok, ok ? '' : '超时');
      // 饼图断言必须等**两路 feed 都到齐**之后再跑，而且要放在主链上：
      //   1. 回复那一路要按吧反查吧名（回复 feed 只给 forumId），还要排在串行限速队列里，
      //      实测比主题帖晚好几秒甚至更久才到 —— 这正是用户报的"有时只统计了发帖的数据"；
      //   2. 以前这里用 until 等 30 秒，超时回调落在 finish() 之后，
      //      结果**整段饼图断言一条都没进结果**（排查时会误以为"饼图都测过了"）。
      // 现在把等待放在主链上、有上限、且把超时如实报出来。
      until(function () {
        return rowsIn(subPane('reply')).length > 0 && !inPanel('.tb-eztb-pie-pending');
      }, function (settled) {
        add('两路 feed 都进了饼图（回复那一路最多等 12 秒）', settled,
            '主题帖 ' + rowsIn(subPane('topic')).length + ' 行 / 回复 ' + rowsIn(subPane('reply')).length +
            ' 行 / ' + (inPanel('.tb-eztb-pie-pending') ? '饼图还标着"数据还在加载"' : '饼图没有"还在加载"标记'));
        extrasPie();
        extrasReplies();
      }, 60);
    }, 200);
  }

  /** 占比饼图：现在是「发帖都发在哪些吧」，各段百分比必须合成 100%，图例要有吧名与条数 */
  function extrasPie() {
    var pieTotalEl = inPanel('.tb-eztb-pie-total');
    add('发帖页签的饼图已渲染', !!pieTotalEl,
        'pie-total=' + (pieTotalEl ? String(pieTotalEl.textContent) : '(没有这个元素)') +
        ' / 主题帖行=' + rowsIn(subPane('topic')).length +
        ' / 回复行=' + rowsIn(subPane('reply')).length);
    extrasPieAssert();
  }

  function extrasPieAssert() {
    var pie = inPanel('.tb-eztb-pane[data-pane="posts"] .tb-eztb-piestat .tb-eztb-pie');
    add('「发帖」页签顶部画出了占比饼图', !!pie, pie ? String(pie.textContent).slice(0, 70) : '没找到');
    var panePosts = postsPane();
    var arcs = panePosts ? panePosts.querySelectorAll('.tb-eztb-pie-slice') : [];
    var percents = Array.prototype.map.call(
      panePosts ? panePosts.querySelectorAll('.tb-eztb-pie-percent') : [],
      function (el) { return parseFloat(el.textContent) || 0; }
    );
    var counts = panePosts ? panePosts.querySelectorAll('.tb-eztb-pie-count') : [];
    var sum = percents.reduce(function (a, b) { return a + b; }, 0);
    var labels = Array.prototype.map.call(
      panePosts ? panePosts.querySelectorAll('.tb-eztb-pie-label') : [],
      function (el) { return el.textContent; }
    );
    add('饼图图例有 吧名 + 占比 + 条数', percents.length > 0 &&
        percents.length === counts.length && labels.length === percents.length,
        percents.length + ' 段 / ' + counts.length + ' 个条数');
    add('各段占比合计 100%', Math.abs(sum - 100) < 0.5,
        percents.map(function (v) { return v.toFixed(1); }).join('+') + '=' + sum.toFixed(1));
    add('图例写的是吧名（不再是「主题帖/回复/楼中楼」）',
        labels.length > 0 && labels.every(function (name) {
          return name !== '主题帖' && name !== '回复' && name !== '楼中楼';
        }), labels.join(' / '));
    add('画出来的扇段数与图例条数一致', arcs.length > 0 &&
        arcs.length === percents.length, arcs.length + ' 段');
    // 两路 feed 都算进图里 / 饼图条数 = 两路已加载行数。
    // 判据**不用魔数**（以前写的是「已加载 2x~9x 条」这种区间，29 条也能蒙混过关），
    // 而是直接和两路子页签的行数比。
    // 注意：这段跑在页面的模板字符串里，正则里的 \\d 要写两个反斜杠——
    // 只写一个的话浏览器拿到的是 /(d+)/，永远匹配不上，断言就成了死代码
    // （这正是 1.6.0 那次"饼图不变量"的翻车方式，见 HANDOFF §5 #28）。
    var totalText = String((panePosts ? panePosts.querySelector('.tb-eztb-pie-total') : {}).textContent || '');
    var topicRows = rowsIn(subPane('topic')).length;
    var replyRows = rowsIn(subPane('reply')).length;
    var pieTotalMatch = totalText.match(/已加载 (\\d+) 条/);
    var pieTotal = pieTotalMatch ? Number(pieTotalMatch[1]) : NaN;
    add('主题帖与回复都算进了饼图（饼图条数 > 只有主题帖时的条数）',
        isFinite(pieTotal) && replyRows > 0 && pieTotal > topicRows,
        totalText + '（主题帖 ' + topicRows + ' + 回复 ' + replyRows + '）');
    // 最要紧的不变量：饼里的条数 = 两路子页签里已经加载出来的行数（一条不多、一条不少）。
    // 早先吧名解析失败的行会被静默丢掉，饼图就只剩主题帖（用户报的"有时只统计了发帖的数据"）。
    add('饼图条数 = 两路 feed 已加载的行数（吧名认不出来的行也不许丢）',
        pieTotal === topicRows + replyRows,
        '饼图 ' + (pieTotalMatch ? pieTotalMatch[1] : '?') + ' 条 / 列表 ' +
          topicRows + '+' + replyRows + '=' + (topicRows + replyRows) + ' 条');
    add('饼图没有画出 NaN', String(pie && pie.textContent).indexOf('NaN') < 0, '');

    // 「还不完整」的提示只在数据没到齐时挂着；两路都到齐后必须消失（否则它会变成噪音）
    var pendingNote = panePosts ? panePosts.querySelector('.tb-eztb-piestat .tb-eztb-pie-pending') : null;
    add('两路到齐后「数据还在加载」的提示要消失', !pendingNote,
        pendingNote ? String(pendingNote.textContent).slice(0, 50) : '没有残留');
    var failNotes = panePosts ? panePosts.querySelectorAll('.tb-eztb-piestat .tb-eztb-warn') : [];
    add('两路都取到了就不该留「哪一路没取到」的警告', failNotes.length === 0,
        failNotes.length + ' 条');

    // 「查看全部 N 个吧的占比」：有些用户"其它"占比大，需要摊开看每一个吧
    var listBtn = panePosts ? panePosts.querySelector('[data-act="pie-all"]') : null;
    add('有「查看全部 N 个吧的占比」按钮', !!listBtn, listBtn ? listBtn.textContent : '没找到');
    if (listBtn) {
      var listRowsBefore = panePosts.querySelectorAll('.tb-eztb-pieitem').length;
      listBtn.click();
      var listRowsAfter = panePosts.querySelectorAll('.tb-eztb-pieitem').length;
      var listBtnAfter = panePosts.querySelector('[data-act="pie-all"]');
      add('点按钮会展开全部吧的列表（每个吧一行）',
          listRowsAfter >= 2 && listRowsAfter > listRowsBefore,
          listRowsBefore + ' → ' + listRowsAfter + ' 行');
      add('列表里每一行都有吧名 / 条数 / 占比',
          (function () {
            var rows = panePosts.querySelectorAll('.tb-eztb-pieitem');
            return rows.length > 0 && Array.prototype.every.call(rows, function (row) {
              return !!row.querySelector('.tb-eztb-pieitem-name') &&
                !!row.querySelector('.tb-eztb-pieitem-count') &&
                !!row.querySelector('.tb-eztb-pieitem-percent');
            });
          })(), '');
      add('展开后按钮变成「收起」', !!listBtnAfter && listBtnAfter.textContent === '收起',
          listBtnAfter ? listBtnAfter.textContent : '没找到');
      if (listBtnAfter) {
        listBtnAfter.click();
        add('再点一次会收起', panePosts.querySelectorAll('.tb-eztb-pieitem').length === 0,
            panePosts.querySelectorAll('.tb-eztb-pieitem').length + ' 行');
      }
    }
  }

  /** 回复正文 + 「查楼层」：正文要直接显示，楼层点了才查 */
  function extrasReplies() {
    var replyBtn = inPanel('.tb-eztb-subtab[data-subtab="reply"]');
    add('存在「回复」子页签按钮（阶段 8）', !!replyBtn, '');
    if (!replyBtn) { extrasSignIn(); return; }
    replyBtn.click();
    until(function () { return rowsIn(subPane('reply')).length > 0; }, function (gotReply) {
      add('阶段 8：回复子页签拉到真实数据', gotReply, '共 ' + rowsIn(subPane('reply')).length + ' 行');
      var rows = Array.prototype.slice.call(rowsIn(subPane('reply')));
      var withContent = rows.filter(function (row) {
        var sub = row.querySelector('.tb-eztb-row-sub');
        if (!sub) return false;
        // 副标题里除了正文，还有吧名小标签与楼中楼的「↩ 谁」——把这两块剔除后再看还有没有正文。
        // 判据是"非空"而不是"够长"：真实数据里有人只回了一个"有"或"1"（实测）。
        // （早先判断的是整段 textContent 的长度，光靠吧名标签就能满足，等于没测；变异测试时发现的。）
        return rowBodyText(row).length > 0;
      });
      add('回复行显示了回复正文（不再只有标题）', withContent.length > 0,
          withContent.length + '/' + rows.length + ' 行有正文');
      add('刷新/重渲染后正文仍在（不是只在第一次渲染时有）',
          withContent.length > 0 && withContent.length === rows.length,
          withContent.length + ' 行有正文');

      // 副标题由纯函数 postRowSubParts（core/postStats.ts）统一产出——吧名标签、
      // 楼中楼的「回复了谁」、回复正文都在那里拼。这里确认面板确实走的是这一份：
      // 吧名标签与离线单测里的标记完全一致。
      var withForumTag = rows.filter(function (row) {
        return !!row.querySelector('.tb-eztb-row-sub .tb-eztb-row-forum');
      });
      add('回复行的吧名标签由共享渲染函数产出',
          withForumTag.length > 0,
          withForumTag.length + '/' + rows.length + ' 行带吧名标签');
      add('「回复了谁」标记只可能出现在楼中楼行上',
          Array.prototype.every.call(
            subPane('reply').querySelectorAll('.tb-eztb-row-replyto'),
            function (el) {
              var row = el.closest ? el.closest('.tb-eztb-row') : null;
              return !!row && !!row.querySelector('.tb-eztb-tag-sub');
            }),
          '共 ' + subPane('reply').querySelectorAll('.tb-eztb-row-replyto').length + ' 个');

      var floorBtn = subPane('reply').querySelector('.tb-eztb-floorbtn');
      add('回复行带「查楼层」按钮', !!floorBtn, floorBtn ? floorBtn.textContent : '没找到');
      add('没点之前不显示楼层（不会自动批量发请求）',
          subPane('reply').querySelectorAll('.tb-eztb-floor').length === 0,
          '已有 ' + subPane('reply').querySelectorAll('.tb-eztb-floor').length + ' 个楼层标记');
      if (!floorBtn) { extrasSignIn(); return; }

      // replaceWith 之后原按钮的 parentNode 会变成 null，所以先把所在行记下来
      var floorRow = floorBtn.closest('.tb-eztb-row');
      floorBtn.click();
      add('点「查楼层」后按钮进入查询中状态',
          /查询中|查不到|查询失败/.test(floorBtn.textContent), floorBtn.textContent);
      until(function () {
        if (!floorRow) return true;
        return !!floorRow.querySelector('.tb-eztb-floor') ||
          !floorBtn.isConnected ||
          /查不到|查询失败/.test(floorBtn.textContent);
      }, function (done) {
        var chip = floorRow ? floorRow.querySelector('.tb-eztb-floor') : null;
        add('点「查楼层」后换成了「N楼」', !!chip && /楼/.test(chip.textContent),
            chip
              ? chip.textContent
              : '等到了 ' + done + '，按钮现在=' + floorBtn.textContent +
                ' 标题=' + floorBtn.getAttribute('title') +
                ' 还在页面上=' + floorBtn.isConnected +
                '；相关请求=' + JSON.stringify(
                  window.__tbLog.filter(function (item) {
                    return item.url.indexOf('/c/f/pb/floor') >= 0;
                  }).slice(-3)
                ));
        add('楼层标记带上了那一楼的内容（用来判断回的是哪一楼）',
            !!chip && String(chip.getAttribute('title')).length > 4,
            chip ? String(chip.getAttribute('title')).slice(0, 50) : '');
        extrasSignIn();
      }, 150);
    }, 100);
  }

  /** 签到号检测：点了才查，查完要给结论，并逐行补上"近期发言 N 条" */
  function extrasSignIn() {
    var forumsTab = inPanel('.tb-eztb-tab[data-tab="forums"]');
    add('存在「关注的吧」页签（阶段 8）', !!forumsTab, '');
    if (!forumsTab) { extrasHidden(); return; }
    forumsTab.click();
    until(function () {
      var pane = document.querySelector('.tb-eztb-pane[data-pane="forums"]');
      return !!pane && !!pane.querySelector('[data-act="activity"]');
    }, function (ready) {
      var pane = inPanel('.tb-eztb-pane[data-pane="forums"]');
      var button = pane && pane.querySelector('[data-act="activity"]');
      add('「关注的吧」里有「检测签到号」按钮', !!button, button ? button.textContent : '没找到');
      add('没点之前不显示发言统计',
          pane && pane.querySelectorAll('.tb-eztb-row-extra').length === 0,
          pane ? pane.querySelectorAll('.tb-eztb-row-extra').length + ' 行已有统计' : '');
      if (!ready || !button) { extrasHidden(); return; }

      button.click();
      until(function () {
        var el = inPanel('.tb-eztb-pane[data-pane="forums"] .tb-eztb-activity');
        return !!el && /判定条件|没有发现|隐藏了发帖记录/.test(String(el.textContent));
      }, function (done) {
        var paneNow = inPanel('.tb-eztb-pane[data-pane="forums"]');
        var text = String(paneNow.querySelector('.tb-eztb-activity').textContent);
        add('点「检测签到号」会给出结论', done, text.slice(0, 110));
        add('结论里写明了判定条件与样本大小（不许说成"从来不发言"）',
            /判定条件/.test(text) && /样本/.test(text), text.slice(0, 160));
        add('每一行都补上了「近期发言 N 条」',
            paneNow.querySelectorAll('.tb-eztb-row-extra').length ===
              paneNow.querySelectorAll('.tb-eztb-row[data-forum]').length,
            paneNow.querySelectorAll('.tb-eztb-row-extra').length + '/' +
              paneNow.querySelectorAll('.tb-eztb-row[data-forum]').length + ' 行');
        add('检测跑完后按钮变成「重新检测」', button.textContent === '重新检测', button.textContent);
        add('检测签到号期间没有 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
        extrasHidden();
      }, 150);
    }, 100);
  }

  /**
   * 对方隐藏了发帖记录：必须说"看不到"，不能说"他没有公开的主题帖"。
   * 这个用户的 userpost 响应由本地代理顶成 hidePost=1（见 click-test.mjs 顶部说明）。
   */
  function extrasHidden() {
    var close = document.querySelector('.tb-eztb-close');
    if (close) close.click();
    add('（阶段 8）隐藏用例前旧面板已关闭', !document.querySelector('.tb-eztb-mask'),
        '还剩 ' + document.querySelectorAll('.tb-eztb-mask').length + ' 个遮罩');
    var hiddenBtn = document.querySelector('#hidden-post .tb-eztb-btn');
    add('隐藏发帖的测试用户也注入了按钮', !!hiddenBtn, '');
    if (!hiddenBtn) { extrasDone(); return; }
    hiddenBtn.click();
    until(function () {
      return !!inPanel('.tb-eztb-kv') && !!inPanel('.tb-eztb-tab[data-tab="posts"]');
    }, function (opened) {
      add('隐藏发帖用户的面板已打开并解析出资料', opened, '');
      var tab = inPanel('.tb-eztb-tab[data-tab="posts"]');
      if (!opened || !tab) { extrasDone(); return; }
      tab.click();
      until(function () {
        var pane = postsPane();
        return !!pane && pane.querySelectorAll('.tb-eztb-row').length === 0 && !!pane.querySelector('.tb-eztb-warn');
      }, function (got) {
        var pane = postsPane();
        var text = String(pane && pane.textContent);
        var who = String((inPanel('.tb-eztb-title') || {}).textContent || '?') +
          ' / ' + String((inPanel('.tb-eztb-sub') || {}).textContent || '?');
        add('把发帖信息设为私密时给出了原因提示', /私密/.test(text),
            '面板=' + who + ' 内容=' + text.slice(0, 90));
        add('隐藏时不再说"该用户没有公开的主题帖"',
            !/没有公开的主题帖/.test(text), text.slice(0, 130));
        add('隐藏时列表为空（拿不到内容就是拿不到）',
            rowsIn(subPane('topic')).length === 0,
            '行数 ' + rowsIn(subPane('topic')).length);
        extrasDone();
      }, 150);
    }, 100);
  }

  function extrasDone() {
    add('阶段 8 结束：运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
    finish();
  }

  /**
   * 阶段 6：页面上的成分标记。
   *
   * 规则是「名单命中」，所以标记一定会出现在被点名的那位作者旁边，
   * 而另一位测试用户（翻页用的那位）不在名单里，必须一个标记都没有。
   */
  function phaseBadges() {
    // 上一个阶段的面板还开着，遮罩会盖住整个视口，命中测试必须先关掉它
    document.querySelector('.tb-eztb-close')?.click();
    add('先关掉上一个面板（否则遮罩挡住页面元素）',
        !document.querySelector('.tb-eztb-mask'), '');

    var badges = document.querySelectorAll('.tb-eztb-badges');
    var badge = document.querySelector('.l_post .tb-eztb-badges .tb-eztb-badge');
    add('命中的用户旁出现了成分标记', !!badge, badge ? badge.textContent : '没找到标记');
    add('只有命中的用户被标记', badges.length === 1, '标记组 ' + badges.length + ' 个');
    add('未命中的用户没有标记', !document.querySelector('#pager-post .tb-eztb-badges'), '');
    if (!badge) {
      add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
      finish();
      return;
    }
    add('标记紧跟在「查询」按钮之后', (function () {
      var prev = badge.closest('.tb-eztb-badges').previousElementSibling;
      return !!prev && prev.classList.contains('tb-eztb-btn');
    })(), '');
    add('标记的提示里写清了原因', /名单/.test(badge.title),
        String(badge.getAttribute('title')).split('\\n').join(' / '));
    add('标记可以点中（没有被页面容器吃掉点击）', (function () {
      var r = badge.getBoundingClientRect();
      var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === badge || badge.contains(hit);
    })(), '');
    add('标记显式声明了 pointer-events:auto（新版页面的容器常为 none，坑 #1 的同类）',
        getComputedStyle(badge).pointerEvents === 'auto',
        getComputedStyle(badge).pointerEvents);

    badge.click();
    setTimeout(function () {
      add('点标记会打开面板并停在「成分」页签',
          !!document.querySelector('.tb-eztb-tab[data-tab="composition"].active') &&
            !!document.querySelector('.tb-eztb-pane[data-pane="composition"].active'), '');
      var pane = document.querySelector('.tb-eztb-pane[data-pane="composition"]');
      var text = String(pane && pane.textContent);
      add('成分页签里列出了命中的规则名', /测试名单/.test(text), text.slice(0, 60));
      add('成分页签里说明了原因', /在名单里/.test(text), text.slice(0, 120));
      add('成分页签里没有"可能是误判"的弱证据提示', !/误判/.test(text), '');
      // 这一段的断言要么直接跑，要么等「关注的吧」页签查完后跑（顺序不影响结论）
      var restOfBadgePhase = function () {
      add('隐藏了的关注贴吧也能参与判定（规则写的是关注吧关键词）',
          /关注了「${HIDDEN_FORUM_KEYWORD}」/.test(text), text.slice(0, 120));
      add('成分页签说明了有多少吧来自隐藏关注贴吧的恢复',
          /隐藏关注贴吧的恢复/.test(text), text.slice(0, 160));
      add('两个规则各出一个标记',
          document.querySelectorAll('.l_post .tb-eztb-badges .tb-eztb-badge').length === 2,
          '标记 ' + document.querySelectorAll('.l_post .tb-eztb-badges .tb-eztb-badge').length + ' 个');
      add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));

      // ── 阶段 7：菜单里的「重新检测本页用户」必须真的重新取数 ──
      var rescanLabel = Object.keys(window.__tbMenus).filter(function (label) {
        return /重新检测/.test(label);
      })[0];
      add('菜单里注册了「重新检测本页用户」', !!rescanLabel,
          Object.keys(window.__tbMenus).join(' / '));
      add('菜单里注册了「清空成分缓存」',
          Object.keys(window.__tbMenus).some(function (label) { return /清空成分缓存/.test(label); }),
          '');
      if (!rescanLabel) { finish(); return; }
      var requestsBefore = window.__tbRequests;
      window.__tbMenus[rescanLabel]();
      add('重新检测会给用户一个提示', window.__tbAlerts.length > 0,
          window.__tbAlerts[window.__tbAlerts.length - 1] || '');
      until(function () {
        // 等到"确实重新发了请求"且"标记重新贴回来了"：重新检测会先摘掉旧标记
        return window.__tbRequests > requestsBefore &&
          !!document.querySelector('.l_post .tb-eztb-badges .tb-eztb-badge');
      }, function (fetched) {
        add('「重新检测本页用户」会绕过缓存真的重新取数', fetched,
            '请求数 ' + requestsBefore + ' → ' + window.__tbRequests);
        add('重新检测后标记依然在', !!document.querySelector('.l_post .tb-eztb-badges .tb-eztb-badge'), '');
        add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
        phaseExtras();
      }, 60);
      };

      // 「关注的吧」页签：测试用户隐藏了关注贴吧，正好覆盖"恢复出来的列表 + 为什么没等级"
      var forumsTab = document.querySelector('.tb-eztb-tab[data-tab="forums"]');
      add('存在「关注的吧」页签', !!forumsTab, '');
      if (!forumsTab) {
        restOfBadgePhase();
        return;
      }
      forumsTab.click();
      until(function () {
        var pane = document.querySelector('.tb-eztb-pane[data-pane="forums"]');
        return !!pane && pane.querySelectorAll('.tb-eztb-row').length > 0;
      }, function (ok) {
        var forumsPane = document.querySelector('.tb-eztb-pane[data-pane="forums"]');
        var forumsText = String(forumsPane && forumsPane.textContent);
        add('「关注的吧」页签列出了恢复出来的吧', ok,
            '共 ' + (forumsPane ? forumsPane.querySelectorAll('.tb-eztb-row').length : 0) + ' 个');
        add('「关注的吧」页签说明了这是还原出来的列表',
            /未公开/.test(forumsText), forumsText.slice(0, 80));
        add('「关注的吧」页签说明了等级为什么缺失',
            /没有设置用户名|缺少等级信息/.test(forumsText), forumsText.slice(0, 140));

        // 「点了才查」的等级：没等级的吧应当带一个按钮，点它去他在该吧的帖子里找
        var levelButtons = forumsPane
          ? forumsPane.querySelectorAll('.tb-eztb-levelbtn')
          : [];
        add('没有等级的吧都带「查等级」按钮', levelButtons.length > 0,
            '按钮 ' + levelButtons.length + ' 个');
        if (!levelButtons.length) {
          restOfBadgePhase();
          return;
        }
        var levelButton = levelButtons[0];
        var levelForum = levelButton.getAttribute('data-forum');
        levelButton.click();
        add('点「查等级」后按钮进入查询中状态',
            /查询中|查不到|查询失败/.test(levelButton.textContent),
            levelButton.textContent);
        until(function () {
          var pane = document.querySelector('.tb-eztb-pane[data-pane="forums"]');
          var btn = pane && pane.querySelector('.tb-eztb-levelbtn[data-forum="' + levelForum + '"]');
          // 查到就换成 Lv.N（按钮没了），查不到就写成"查不到/查询失败"
          if (!btn) return true;
          return /查不到|查询失败/.test(btn.textContent);
        }, function (settled) {
          var pane = document.querySelector('.tb-eztb-pane[data-pane="forums"]');
          var rest = pane && pane.querySelector('.tb-eztb-levelbtn[data-forum="' + levelForum + '"]');
          var gotLevel = !rest;
          add('点「查等级」会给出结果（要么读到 Lv.N，要么明确说查不到）', settled,
              gotLevel
                ? ('「' + levelForum + '」读到了等级')
                : ('「' + levelForum + '」' + rest.textContent + '：' + rest.getAttribute('title')));
          if (gotLevel) {
            var lvText = '';
            Array.prototype.forEach.call(pane.querySelectorAll('.tb-eztb-row'), function (row) {
              if (row.textContent.indexOf(levelForum) >= 0) lvText = row.textContent;
            });
            // 这段代码在 Node 的模板字符串里，能不用正则里的转义就别用（\\d 会被吃掉一层）
            add('读到等级后该行显示 Lv.N', lvText.indexOf('Lv.') >= 0, lvText.slice(0, 60));
          }
          add('查等级期间没有 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
          restOfBadgePhase();
        }, 150);
      }, 100);
    }, 400);
  }

  // 兜底：万一哪一步的断言抛错导致链条断了，也把已经跑出的结果发回来，
  // 否则只能看到一个干巴巴的"浏览器未返回结果"。
  setTimeout(function () {
    add('测试在超时前跑完', false, '中途断了，最后一条断言见上面');
    add('页面 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
    finish();
  }, 150000);

  setTimeout(function () {
    /*
     * ── 阶段 0：诊断面板 ──
     * 诊断入口挂在脚本菜单上，用 __tbMenus 触发。这套测试以前完全没碰过诊断面板，
     * 这里只覆盖"能开、有报告、能关"这三件最基本的事。
     */
    (function () {
      var diagnose = window.__tbMenus['eztb：诊断当前页面'];
      add('菜单里注册了「诊断当前页面」', typeof diagnose === 'function', '');
      if (typeof diagnose !== 'function') return;
      diagnose();
      var report = document.querySelector('.tb-eztb-mask .tb-eztb-report');
      add('诊断面板打开并渲染出报告', !!report, '');
      var text = report ? String(report.textContent) : '';
      add('报告里有在飞请求数', text.indexOf('在飞请求') >= 0, '');
      var closeBtn = document.querySelector('.tb-eztb-mask .tb-eztb-close');
      if (closeBtn) closeBtn.click();
      add('诊断面板能关掉（不留遮罩）', !document.querySelector('.tb-eztb-mask'), '');
      add('阶段 0 没有 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
    })();

    // ── 阶段 1：注入与命中 ──
    var buttons = document.querySelectorAll('.tb-eztb-btn');
    add('按钮已注入（新版+旧版）', buttons.length >= 2, '共 ' + buttons.length + ' 个');

    var newButton = document.querySelector('.head-line .tb-eztb-btn');
    var oldButton = document.querySelector('.l_post .tb-eztb-btn');
    add('旧版按钮注入成功', !!oldButton, '');
    if (oldButton) { var oh = hitTest(oldButton); add('旧版按钮命中测试', oh.ok, oh.why); }
    add('新版按钮落在 .btn-wrapper 内', !!newButton && !!newButton.closest('.btn-wrapper'), '');
    if (newButton) {
      var wrapper = newButton.closest('.btn-wrapper');
      add('测试场景确实带 pointer-events:none 容器',
          wrapper ? getComputedStyle(wrapper).pointerEvents === 'none' : false,
          wrapper ? getComputedStyle(wrapper).pointerEvents : '未找到容器');
      add('按钮计算样式为 pointer-events:auto',
          getComputedStyle(newButton).pointerEvents === 'auto',
          getComputedStyle(newButton).pointerEvents);
      var hit = hitTest(newButton);
      add('命中测试（pointer-events:none 容器内仍可点中）', hit.ok, hit.why);
    }

    // 点旧版按钮：它带真实 user_id，可直接解析出用户
    var clickTarget = oldButton || newButton;
    if (!clickTarget) { add('存在可点击按钮', false, ''); finish(); return; }
    clickTarget.click();
    add('点击后面板已打开', !!document.querySelector('.tb-eztb-mask'), '');

    /*
     * 焦点陷阱（2026-09-28 修的那个洞）：打开时焦点落在弹窗容器本身（tabIndex = -1），
     * 旧代码用 dialogEl.contains(activeElement) 判"在不在弹窗里"，容器自己是 true，
     * 于是反向 Tab 不会被拦，焦点会退到遮罩后面的页面元素上。
     *
     * 合成事件不会真的移动焦点，但会走我们的 keydown 处理器；处理器拦没拦下这次
     * Tab 可以直接从 dispatchEvent 的返回值读出来（返回 false = 调用了 preventDefault）。
     * 所以这几条在旧代码上会红——正好是"改回坏的样子，断言必须失败"的那种断言。
     */
    (function () {
      var scope = lastMask();
      var dialog = scope && scope.querySelector('.tb-eztb-dialog');
      if (!dialog) { add('焦点陷阱：找到弹窗容器', false, ''); return; }
      var items = Array.prototype.filter.call(
        dialog.querySelectorAll(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        ),
        function (el) { return !el.hasAttribute('disabled') && el.offsetParent !== null; }
      );
      function tabPrevented(el, shiftKey) {
        var ev = new KeyboardEvent('keydown', {
          key: 'Tab', shiftKey: !!shiftKey, bubbles: true, cancelable: true
        });
        return el.dispatchEvent(ev) === false;
      }
      dialog.focus();
      add('焦点陷阱：打开后焦点落在弹窗容器上',
          document.activeElement === dialog,
          String(document.activeElement && document.activeElement.className));
      add('焦点陷阱：容器上反向 Tab 会被拦下（不会退到遮罩后面）',
          tabPrevented(dialog, true), '');
      add('焦点陷阱：容器上正向 Tab 会被拦下（转交给第一个可聚焦项）',
          tabPrevented(dialog, false), '');
      add('焦点陷阱：弹窗里有可聚焦元素', items.length > 0, '共 ' + items.length + ' 个');
      if (items.length) {
        var last = items[items.length - 1];
        var first = items[0];
        last.focus();
        add('焦点陷阱：最后一个可聚焦项上正向 Tab 会回卷到第一个',
            tabPrevented(last, false), '');
        first.focus();
        add('焦点陷阱：第一个可聚焦项上反向 Tab 会回卷到最后一个',
            tabPrevented(first, true), '');
      }
      dialog.focus();
    })();

    // ── 阶段 2：真实数据渲染 ──
    until(function () { return !!document.querySelector('.tb-eztb-kv'); }, function (ok) {
      add('资料页签用真实数据渲染', ok, ok ? (document.querySelector('.tb-eztb-kv').textContent || '').slice(0, 40) : '超时');
      var postsTab = document.querySelector('.tb-eztb-tab[data-tab="posts"]');
      add('存在「发帖」页签', !!postsTab, '');
      if (!postsTab) { add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; ')); finish(); return; }
      postsTab.click();
      until(function () {
        return rowsIn(subPane('topic')).length > 0;
      }, function (got) {
        add('发帖页签默认展示「主题帖」子页签并拉到真实数据', got,
            got ? ('共 ' + rowsIn(subPane('topic')).length + ' 行')
                : ('面板内容: ' + String(postsPane() && postsPane().textContent).slice(0, 160)));
        if (!got) {
          add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
          finish();
          return;
        }

        // 两个子页签：主题帖 / 回复，各自独立分页
        var subTabs = document.querySelectorAll('.tb-eztb-pane[data-pane="posts"] .tb-eztb-subtab');
        var subLabels = Array.prototype.map.call(subTabs, function (b) {
          return b.textContent;
        }).join('/');
        add('发帖页签拆成「主题帖 / 回复」两个子页签',
            subTabs.length === 2 && subLabels === '主题帖/回复', subLabels);
        add('默认子页签是主题帖',
            !!(subPane('topic') && subPane('topic').classList.contains('active')) &&
              !!(subPane('reply') && !subPane('reply').classList.contains('active')), '');
        add('任一时刻只有一个子页签可见',
            visibleSubPanes().length === 1, '可见 ' + visibleSubPanes().length + ' 个');

        var topicKinds = kindCounts(subPane('topic'));
        add('主题帖子页签里只有主题帖',
            Object.keys(topicKinds).length === 1 && (topicKinds['主题'] || 0) > 0,
            JSON.stringify(topicKinds));
          // 2026-09-27 起：进「发帖」页签就把两路 feed 的第一页都取回来（饼图要按吧统计，
          // 只算主题帖会漏一半）。两路走的是同一条串行限速队列，回复通常会比主题帖晚一点到，
          // 所以这里只断言"没显示出来"，"两路都统计进饼图"留到阶段 8 等数据到齐再判。
          add('预先加载的「回复」子页签没有显示出来',
              !subPane('reply').classList.contains('active') &&
                subPane('reply').getBoundingClientRect().height === 0, '');
        checkLayout(subPane('topic'), '主题帖');

        // ── 阶段 2b：切到「回复」子页签 ──
        var replyBtn = document.querySelector('.tb-eztb-pane[data-pane="posts"] .tb-eztb-subtab[data-subtab="reply"]');
        add('存在「回复」子页签按钮', !!replyBtn, '');
        if (!replyBtn) { add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; ')); finish(); return; }
        replyBtn.click();
        until(function () { return rowsIn(subPane('reply')).length > 0; }, function (gotReply) {
          add('回复子页签拉到真实数据', gotReply, '共 ' + rowsIn(subPane('reply')).length + ' 行');
          add('切到「回复」后主题帖内容已隐藏',
              !subPane('topic').classList.contains('active') && visibleSubPanes().length === 1,
              '可见子页签 ' + visibleSubPanes().length + ' 个');
          var replyKinds = kindCounts(subPane('reply'));
          add('回复子页签只有「回复 / 楼中楼」两种标签',
              Object.keys(replyKinds).every(function (k) { return k === '回复' || k === '楼中楼'; }) &&
                (replyKinds['回复'] || 0) > 0,
              JSON.stringify(replyKinds));
          add('楼中楼标记仍然保留', (replyKinds['楼中楼'] || 0) > 0, JSON.stringify(replyKinds));
          if (gotReply) checkLayout(subPane('reply'), '回复');

          // ── 阶段 2c：两个子页签的分页互相独立 ──
          var topicRowsBefore = rowsIn(subPane('topic')).length;
          var replyRowsBefore = rowsIn(subPane('reply')).length;
          var replyMoreTextBefore = moreIn(subPane('reply')) ? moreIn(subPane('reply')).textContent : '';
          add('两个子页签各有自己的「加载更多」按钮',
              !!moreIn(subPane('topic')) && !!moreIn(subPane('reply')) &&
                moreIn(subPane('topic')) !== moreIn(subPane('reply')), '');

          // 先在「主题帖」子页签翻页：另一边的「回复」不能被动到
          moreIn(subPane('topic')).click();
          until(function () {
            var btn = moreIn(subPane('topic'));
            return !btn || !btn.disabled;
          }, function () {
            var topicRowsAfter = rowsIn(subPane('topic')).length;
            var topicMoreText = moreIn(subPane('topic')) ? moreIn(subPane('topic')).textContent : '';
            var replyUntouched =
              rowsIn(subPane('reply')).length === replyRowsBefore &&
              (moreIn(subPane('reply')) ? moreIn(subPane('reply')).textContent : '') === replyMoreTextBefore;
            add('在「主题帖」子页签翻页不影响「回复」子页签', replyUntouched,
                '回复 ' + replyRowsBefore + ' → ' + rowsIn(subPane('reply')).length);
            add('「主题帖」子页签能独立翻到下一页',
                topicRowsAfter > topicRowsBefore || topicMoreText === '没有更多了',
                '主题 ' + topicRowsBefore + ' → ' + topicRowsAfter + '，按钮=' + topicMoreText);

            // 再翻「回复」子页签：反过来也不能动到「主题帖」
            var topicRowsLoaded = topicRowsAfter;
            if (moreIn(subPane('reply'))) moreIn(subPane('reply')).click();
            until(function () {
              var btn = moreIn(subPane('reply'));
              return !btn || !btn.disabled;
            }, function () {
              var replyRowsAfter = rowsIn(subPane('reply')).length;
              var replyMoreText = moreIn(subPane('reply')) ? moreIn(subPane('reply')).textContent : '';
              add('在「回复」子页签翻页不影响「主题帖」子页签',
                  rowsIn(subPane('topic')).length === topicRowsLoaded,
                  '主题 ' + topicRowsLoaded + ' → ' + rowsIn(subPane('topic')).length);
              add('「回复」子页签能独立翻到下一页',
                  replyRowsAfter > replyRowsBefore || replyMoreText === '没有更多了',
                  '回复 ' + replyRowsBefore + ' → ' + replyRowsAfter + '，按钮=' + replyMoreText);

              // 切回主题帖：内容保留，行数不变
              var topicBtn = document.querySelector('.tb-eztb-pane[data-pane="posts"] .tb-eztb-subtab[data-subtab="topic"]');
              topicBtn.click();
              setTimeout(function () {
                add('切回「主题帖」子页签时已加载的内容保留',
                    rowsIn(subPane('topic')).length === topicRowsLoaded &&
                      subPane('topic').classList.contains('active') &&
                      visibleSubPanes().length === 1,
                    '主题 ' + rowsIn(subPane('topic')).length + ' 行，可见子页签 ' + visibleSubPanes().length + ' 个');

              // ── 阶段 3：反复切换页签 ──
              var profileTab = document.querySelector('.tb-eztb-tab[data-tab="profile"]');
              var postsTabEl = document.querySelector('.tb-eztb-tab[data-tab="posts"]');
              add('切换前记录了发帖行数', rowsIn(subPane('topic')).length > 0,
                  '共 ' + rowsIn(subPane('topic')).length + ' 行');

              profileTab.click();
              setTimeout(function () {
                add('切回「资料」后资料内容可见', visible(document.querySelector('.tb-eztb-kv')), '');
                add('切回「资料」后发帖内容已隐藏', !visible(subPane('topic')), '');
                add('任一时刻只有一个页签容器可见',
                    visiblePanes().length === 1, '可见 ' + visiblePanes().length + ' 个');

                postsTabEl.click();
                setTimeout(function () {
                  add('再切回「发帖」列表仍在且可见',
                      rowsIn(subPane('topic')).length === topicRowsLoaded && visible(subPane('topic')),
                      '共 ' + rowsIn(subPane('topic')).length + ' 行');
                  add('再切回「发帖」后资料内容已隐藏',
                      !visible(document.querySelector('.tb-eztb-kv')), '');
                  add('反复切换后仍只有一个容器可见',
                      visiblePanes().length === 1, '可见 ' + visiblePanes().length + ' 个');

                  postsTabEl.click();
                  profileTab.click();
                  postsTabEl.click();
                  setTimeout(function () {
                    add('连续快速切换 3 次后内容仍然正确',
                        visible(subPane('topic')) &&
                          !visible(document.querySelector('.tb-eztb-kv')) &&
                          visiblePanes().length === 1,
                        '可见容器 ' + visiblePanes().length + ' 个');

                    // ── 阶段 4：手动刷新 ──
                    var refreshBtn = document.querySelector('[data-act="refresh"]');
                    add('存在「刷新当前页签」按钮', !!refreshBtn, '');
                    if (!refreshBtn) {
                      add('运行期无 JS 错误', window.__tbErrors.length === 0, window.__tbErrors.join('; '));
                      finish();
                      return;
                    }
                    refreshBtn.click();
                    until(function () {
                      return !refreshBtn.disabled && rowsIn(subPane('topic')).length > 0;
                    }, function (ok) {
                      add('刷新后当前页签重新加载出内容', ok, '');
                      add('刷新后停在刷新前的那个子页签（主题帖）',
                          subPane('topic').classList.contains('active') && visibleSubPanes().length === 1,
                          '可见子页签 ' + visibleSubPanes().length + ' 个');
                      add('刷新按钮文案已复位',
                          refreshBtn.textContent === '刷新当前页签', refreshBtn.textContent);
                      add('刷新只重建当前页签，其它页签内容保留',
                          !!document.querySelector('.tb-eztb-pane[data-pane="profile"] .tb-eztb-kv'), '');
                      add('刷新后仍只有一个容器可见',
                          visiblePanes().length === 1, '可见 ' + visiblePanes().length + ' 个');
                      phasePaging();
                    }, 200);
                  }, 200);
                }, 300);
              }, 300);
            }, 300);
          }, 150);
        }, 150);
      }, 150);
    }, 150);
  }, 150);
}, 400);
</script>
</body></html>`;

// 页面里的内联脚本先自己过一遍语法。
// 这些脚本写在 Node 的模板字符串里，一个没转义的 \n 就会把浏览器里的正则/字符串切断，
// 而浏览器只会给你一句 "Invalid regular expression"，根本看不出是哪一行（踩过）。
for (const [index, match] of Array.from(
	PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g),
).entries()) {
	try {
		new Function(match[1]);
	} catch (error) {
		console.error(
			`页面第 ${index + 1} 个内联脚本有语法错误：${error.message}`,
		);
		process.exit(1);
	}
}

// ── 本地服务：托管页面 + 转发请求 + 收集结果 ─────────────────────────
let resolveResult;
let hiddenStubHits = 0;
const resultPromise = new Promise((resolve) => {
	resolveResult = resolve;
});

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://127.0.0.1");
	// EZTB_DEBUG=1 时打印每一次请求，用来定位"浏览器没返回结果"这类问题
	if (process.env.EZTB_DEBUG) console.log(`  [debug] ${req.method} ${url.pathname}`);

	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(PAGE);
		return;
	}

	if (url.pathname === "/result") {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		resolveResult(Buffer.concat(chunks).toString("utf8"));
		res.writeHead(200);
		res.end("ok");
		return;
	}

	if (url.pathname === "/proxy") {
		const target = url.searchParams.get("u") ?? "";
		if (!/^https:\/\/tiebac\.baidu\.com\//.test(target)) {
			res.writeHead(400);
			res.end("bad target");
			return;
		}
		try {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const body = Buffer.concat(chunks);
			// 只顶掉"隐藏了发帖记录"这一个用户的 userpost：其余请求照旧走真实接口
			if (
				target.includes("/c/u/feed/userpost") &&
				body.includes(HIDDEN_STUB_NEEDLE)
			) {
				hiddenStubHits += 1;
				res.writeHead(200, { "content-type": "application/octet-stream" });
				res.end(HIDDEN_STUB_BYTES);
				return;
			}
			if (process.env.EZTB_DEBUG && target.includes("/c/u/feed/userpost")) {
				console.log(
					`  [debug] userpost 请求体 ${body.length} 字节：${body.subarray(0, 48).toString("hex")} / ascii=${JSON.stringify(body.subarray(0, 48).toString("latin1"))}`,
				);
			}
			const headers = {};
			for (const [key, value] of Object.entries(req.headers)) {
				if (
					[
						"host",
						"origin",
						"referer",
						"connection",
						"content-length",
						"accept-encoding",
					].includes(key)
				) {
					continue;
				}
				headers[key] = value;
			}
			const upstream = await fetch(target, {
				method: req.method,
				headers,
				body:
					req.method === "GET" || req.method === "HEAD" ? undefined : body,
			});
			const buffer = Buffer.from(await upstream.arrayBuffer());
			res.writeHead(upstream.status, {
				"content-type":
					upstream.headers.get("content-type") ?? "application/octet-stream",
			});
			res.end(buffer);
		} catch (error) {
			res.writeHead(502);
			res.end(String(error));
		}
		return;
	}

	res.writeHead(404);
	res.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "eztb-profile-"));
const child = spawn(
	browser,
	[
		"--headless=new",
		"--disable-extensions",
		"--no-first-run",
		"--disable-gpu",
		`--user-data-dir=${profileDir}`,
		`http://127.0.0.1:${port}/`,
	],
	{ stdio: "ignore" },
);

const timeout = new Promise((resolve) =>
	setTimeout(() => resolve("__TIMEOUT__"), 240_000),
);
const raw = await Promise.race([resultPromise, timeout]);
child.kill();
server.close();

if (raw === "__TIMEOUT__") {
	console.error("浏览器未在 240 秒内返回结果");
	process.exit(1);
}

const match = raw.match(/TBSTART([\s\S]*?)TBEND/);
if (!match) {
	console.error("结果格式异常：", raw.slice(0, 800));
	process.exit(1);
}

let failures = 0;
// 「隐藏发帖记录」那条断言依赖这个桩；桩没被命中说明拦截条件写错了（比如 uid 没出现在请求体里）
console.log(`  隐藏发帖桩命中 ${hiddenStubHits} 次`);
for (const line of match[1].trim().split("\n")) {
	const [status, label, detail] = line.split("|");
	if (status === "PASS") {
		console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
	} else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
}
console.log(failures === 0 ? "\n浏览器端验证全部通过。" : `\n${failures} 项失败。`);
process.exit(failures === 0 ? 0 : 1);
