/**
 * 全部样式集中在这里，注入一次。为避免被贴吧页面样式污染，关键属性带 !important。
 *
 * 颜色一律走 `--tb-eztb-*` 变量：默认是亮色，跟随系统的深色偏好会整体切一套。
 * 只有自定义属性定义在 `:root` 上，不会影响页面自己的样式。
 * 注意：这里跟随的是 `prefers-color-scheme`（系统偏好），不是贴吧自己的夜间模式开关
 * ——贴吧那个是页面内一个 class，跟系统偏好不一定同步，猜错了反而更糟。
 */

const THEME_VARS = `
:root{
  --tb-eztb-accent:#1677ff;
  --tb-eztb-accent-border:#bcd8ff;
  --tb-eztb-accent-bg:#e8f3ff;
  --tb-eztb-spinner-track:#d6e4ff;
  --tb-eztb-info-bg:#f2f7ff;
  --tb-eztb-info-border:#cfe0ff;
  --tb-eztb-info-text:#1a4d99;
  --tb-eztb-danger-bg:#fff5f5;
  --tb-eztb-danger-border:#ffd8d8;
  --tb-eztb-danger-text:#c0392b;
  --tb-eztb-warn-bg:#fffaf0;
  --tb-eztb-warn-bg-soft:#fff8e6;
  --tb-eztb-warn-border:#ffe2b8;
  --tb-eztb-warn-text:#8a5a00;
  --tb-eztb-warn-text-strong:#9a6700;
  --tb-eztb-mark-bg:#fff3bf;
  --tb-eztb-text:#222;
  --tb-eztb-text-strong:#24292f;
  --tb-eztb-text-muted:#57606a;
  --tb-eztb-text-dim:#666;
  --tb-eztb-text-faint:#8a8f99;
  --tb-eztb-text-on-soft:#555;
  --tb-eztb-text-busy:#999;
  --tb-eztb-surface:#fff;
  --tb-eztb-surface-alt:#fafbfc;
  --tb-eztb-surface-soft:#f6f8fa;
  --tb-eztb-surface-busy:#fafafa;
  --tb-eztb-surface-hover:#e2e5ea;
  --tb-eztb-chip:#f2f3f5;
  --tb-eztb-chip-alt:#eef0f3;
  --tb-eztb-chip-strong:#eef1f4;
  --tb-eztb-border:#e8e8e8;
  --tb-eztb-border-soft:#e4e8ec;
  --tb-eztb-border-muted:#e0e3e7;
  --tb-eztb-border-input:#d0d7de;
  --tb-eztb-border-busy:#ddd;
  --tb-eztb-pie-track:#eef0f3;
  --tb-eztb-overlay:rgba(0,0,0,.45);
  --tb-eztb-shadow:rgba(0,0,0,.28);
  /* 成分徽章的色相由 JS 按下标给，这里只切明度 */
  --tb-eztb-badge-fg:28%;
  --tb-eztb-badge-bg:94%;
  --tb-eztb-badge-bd:76%;
}
@media (prefers-color-scheme: dark){
  :root{
    --tb-eztb-accent:#4c9aff;
    --tb-eztb-accent-border:#33507a;
    --tb-eztb-accent-bg:#1b2a41;
    --tb-eztb-spinner-track:#33507a;
    --tb-eztb-info-bg:#1c2a3d;
    --tb-eztb-info-border:#33507a;
    --tb-eztb-info-text:#8fbaff;
    --tb-eztb-danger-bg:#3a2326;
    --tb-eztb-danger-border:#5c3236;
    --tb-eztb-danger-text:#ff8b7d;
    --tb-eztb-warn-bg:#322a1c;
    --tb-eztb-warn-bg-soft:#322a1c;
    --tb-eztb-warn-border:#5a4629;
    --tb-eztb-warn-text:#e0b060;
    --tb-eztb-warn-text-strong:#e0b060;
    --tb-eztb-mark-bg:#4a3f1a;
    --tb-eztb-text:#e6e8eb;
    --tb-eztb-text-strong:#e6e8eb;
    --tb-eztb-text-muted:#a8b0ba;
    --tb-eztb-text-dim:#a8b0ba;
    --tb-eztb-text-faint:#8b939d;
    --tb-eztb-text-on-soft:#c2c8d0;
    --tb-eztb-text-busy:#7d858f;
    --tb-eztb-surface:#1c1f24;
    --tb-eztb-surface-alt:#202429;
    --tb-eztb-surface-soft:#262b31;
    --tb-eztb-surface-busy:#262b31;
    --tb-eztb-surface-hover:#333941;
    --tb-eztb-chip:#2b3036;
    --tb-eztb-chip-alt:#2b3036;
    --tb-eztb-chip-strong:#2b3036;
    --tb-eztb-border:#343a41;
    --tb-eztb-border-soft:#343a41;
    --tb-eztb-border-muted:#343a41;
    --tb-eztb-border-input:#3c434b;
    --tb-eztb-border-busy:#3c434b;
    --tb-eztb-pie-track:#343a41;
    --tb-eztb-overlay:rgba(0,0,0,.6);
    --tb-eztb-shadow:rgba(0,0,0,.55);
    --tb-eztb-badge-fg:78%;
    --tb-eztb-badge-bg:20%;
    --tb-eztb-badge-bd:34%;
  }
}
`;

export const STYLE_TEXT = `${THEME_VARS}
.tb-eztb-btn{
  display:inline-block !important;margin-left:6px;padding:2px 10px;
  font:normal 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif !important;
  color:var(--tb-eztb-accent) !important;background:var(--tb-eztb-surface) !important;border:1px solid var(--tb-eztb-accent-border) !important;
  border-radius:6px;cursor:pointer;text-decoration:none !important;vertical-align:middle;
  white-space:nowrap;user-select:none;position:relative;
  /* 行被挤时按钮自己不许被压缩（点了才知道还能不能查） */
  flex:0 0 auto;
  /* 只抬到能盖住同层内容即可。曾经设成 2e9，导致页面弹层/遮罩该盖住按钮时盖不住，
     表现为「本该被遮挡却浮在最上层」。5 与基线脚本一致。 */
  z-index:5;
  opacity:1 !important;visibility:visible !important;box-shadow:none;
  /* 贴吧新版页面的操作条容器常为 pointer-events:none（悬停才展开），
     子元素必须显式恢复，否则按钮看得见、点不动。基线脚本同样用这条覆盖。 */
  pointer-events:auto !important;
}
.tb-eztb-btn:hover{background:var(--tb-eztb-accent-bg) !important;border-color:var(--tb-eztb-accent) !important;}
.tb-eztb-btn.busy{color:var(--tb-eztb-text-busy) !important;border-color:var(--tb-eztb-border-busy) !important;background:var(--tb-eztb-surface-busy) !important;cursor:wait;}

.tb-eztb-mask{
  position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;
  background:var(--tb-eztb-overlay);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
}
.tb-eztb-dialog{
  display:flex;flex-direction:column;width:min(820px,calc(100vw - 32px));
  height:min(84vh,760px);background:var(--tb-eztb-surface) !important;border-radius:12px;overflow:hidden;
  box-shadow:0 12px 48px var(--tb-eztb-shadow);color:var(--tb-eztb-text) !important;font-size:14px;line-height:1.6;
  /* 原生滚动条与表单控件跟着系统偏好走，否则深色弹窗里会拖一条亮色滚动条 */
  color-scheme:light dark;
  /* 弹窗会被注入到贴吧页面里，页面样式可能通过继承污染排版，这里逐项复位 */
  text-align:left !important;text-indent:0 !important;letter-spacing:normal !important;
  word-spacing:normal !important;white-space:normal !important;
  font-weight:400;font-style:normal;
}
.tb-eztb-dialog *{box-sizing:border-box;}
.tb-eztb-head{
  display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid var(--tb-eztb-border);background:var(--tb-eztb-surface-alt) !important;flex:0 0 auto;
}
.tb-eztb-avatar{width:34px;height:34px;border-radius:50%;flex:0 0 auto;background:var(--tb-eztb-chip-alt);}
.tb-eztb-head-main{flex:1 1 auto;min-width:0;}
.tb-eztb-title{
  font-weight:600;font-size:15px;color:var(--tb-eztb-text) !important;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-sub{color:var(--tb-eztb-text-faint) !important;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tb-eztb-close{
  flex:0 0 auto;width:28px;height:28px;line-height:26px;text-align:center;border:none;
  background:var(--tb-eztb-chip-alt) !important;border-radius:50%;cursor:pointer;font-size:16px;color:var(--tb-eztb-text-on-soft) !important;padding:0;
}
.tb-eztb-close:hover{background:var(--tb-eztb-surface-hover) !important;}
.tb-eztb-tabs{
  display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--tb-eztb-border);
  background:var(--tb-eztb-surface) !important;flex:0 0 auto;overflow-x:auto;
}
.tb-eztb-tab{
  border:none;background:transparent !important;cursor:pointer;padding:7px 12px;
  font-size:13px;color:var(--tb-eztb-text-muted) !important;border-bottom:2px solid transparent;white-space:nowrap;
}
.tb-eztb-tab:hover{color:var(--tb-eztb-accent) !important;}
.tb-eztb-tab.active{color:var(--tb-eztb-accent) !important;border-bottom-color:var(--tb-eztb-accent);font-weight:600;}
.tb-eztb-body{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px;background:var(--tb-eztb-surface) !important;}
/* 每个页签一个独立容器：内容互不覆盖，切换只切显隐，异步回调也不会串台 */
.tb-eztb-pane{display:none !important;}
.tb-eztb-pane.active{display:block !important;}
.tb-eztb-foot{
  display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid var(--tb-eztb-border);
  background:var(--tb-eztb-surface-alt) !important;flex:0 0 auto;font-size:12px;color:var(--tb-eztb-text-faint) !important;
}
.tb-eztb-foot .tb-eztb-spacer{flex:1 1 auto;}
.tb-eztb-foot a{color:var(--tb-eztb-accent) !important;text-decoration:none;}
.tb-eztb-linkbtn{
  background:none !important;border:none;padding:0;margin:0;cursor:pointer;
  color:var(--tb-eztb-accent) !important;font-size:12px;font-family:inherit;line-height:1.6;
}
.tb-eztb-linkbtn:hover{text-decoration:underline;}
.tb-eztb-linkbtn[disabled]{color:var(--tb-eztb-text-faint) !important;cursor:default;text-decoration:none;}

.tb-eztb-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:40px 0;color:var(--tb-eztb-text-dim) !important;font-size:13px;}
.tb-eztb-spinner{
  width:22px;height:22px;border:3px solid var(--tb-eztb-spinner-track);border-top-color:var(--tb-eztb-accent);
  border-radius:50%;animation:tb-eztb-spin .8s linear infinite;
}
@keyframes tb-eztb-spin{to{transform:rotate(360deg);}}
.tb-eztb-empty{padding:32px 0;text-align:center;color:var(--tb-eztb-text-faint) !important;font-size:13px;}
.tb-eztb-error{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--tb-eztb-danger-bg) !important;
  border:1px solid var(--tb-eztb-danger-border);color:var(--tb-eztb-danger-text) !important;font-size:13px;word-break:break-all;
}
.tb-eztb-warn{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--tb-eztb-warn-bg) !important;
  border:1px solid var(--tb-eztb-warn-border);color:var(--tb-eztb-warn-text) !important;font-size:12px;
}

.tb-eztb-kv{display:grid;grid-template-columns:96px 1fr;gap:8px 12px;font-size:13px;margin:0;padding:0;}
.tb-eztb-kv dt{color:var(--tb-eztb-text-faint) !important;}
.tb-eztb-kv dd{margin:0;color:var(--tb-eztb-text) !important;word-break:break-word;}

.tb-eztb-list{display:flex;flex-direction:column;gap:2px;}
.tb-eztb-row{
  display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:8px;
  text-decoration:none !important;color:inherit !important;
  text-align:left !important;white-space:normal !important;
}
.tb-eztb-row:hover{background:var(--tb-eztb-surface-soft) !important;}
.tb-eztb-row-avatar{width:30px;height:30px;border-radius:50%;flex:0 0 auto;background:var(--tb-eztb-chip-alt);}
/* 标题与副标题必须是块级，否则 overflow/ellipsis 对行内元素无效，
   两行文字会挤在同一行并撑乱行高。 */
.tb-eztb-row-main{
  flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;
}
.tb-eztb-row-title{
  display:block;max-width:100%;font-size:13px;line-height:1.45;
  color:var(--tb-eztb-text) !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-row-sub{
  display:block;max-width:100%;font-size:12px;line-height:1.4;
  color:var(--tb-eztb-text-faint) !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-row-meta{
  flex:0 0 auto;max-width:40%;font-size:12px;line-height:1.4;
  color:var(--tb-eztb-text-faint) !important;text-align:right;white-space:nowrap;
}
/* 右侧要同时放「查楼层」和时间：竖着排，别把行撑宽 */
.tb-eztb-row-meta-stack{
  display:flex;flex-direction:column;align-items:flex-end;gap:3px;
}
.tb-eztb-row-time{font-size:12px;color:var(--tb-eztb-text-faint) !important;}
/* 副标题里的小吧名：和正文区分开 */
.tb-eztb-row-forum{
  display:inline-block;margin-right:6px;padding:0 5px;border-radius:4px;
  background:var(--tb-eztb-chip) !important;color:var(--tb-eztb-text-muted) !important;font-size:11px;line-height:16px;
}
/* 「检测签到号」之后补上的"近期发言 N 条" */
.tb-eztb-row-extra{color:var(--tb-eztb-text-faint) !important;}
/* 楼中楼回复的对象：淡一点，别抢正文 */
.tb-eztb-row-replyto{color:var(--tb-eztb-text-faint) !important;margin-right:4px;}
/* 楼层号（查到了就换成它） */
.tb-eztb-floor{
  padding:0 6px;border-radius:4px;background:var(--tb-eztb-chip-strong) !important;color:var(--tb-eztb-text-strong) !important;
  font-size:11px;line-height:17px;white-space:nowrap;
}
/* 「疑似只签到」标记：只提示、不结论，所以用弱一点的样式 */
.tb-eztb-signin{
  display:inline-block;margin-right:4px;padding:0 6px;border-radius:999px;
  background:var(--tb-eztb-warn-bg-soft) !important;color:var(--tb-eztb-warn-text-strong) !important;border:1px dashed var(--tb-eztb-warn-border);
  font-size:11px;line-height:16px;white-space:nowrap;
}
/* 「关注的吧」里的签到检测结论区 */
.tb-eztb-activity{margin:0 0 10px;}
.tb-eztb-activity .tb-eztb-hint{margin:0 0 6px;}

/* 「发帖」页签顶部的占比饼图 */
.tb-eztb-piestat{margin:0 0 12px;}
.tb-eztb-pie{
  display:flex;align-items:center;gap:16px;margin:0;padding:10px 12px;
  border:1px solid var(--tb-eztb-border);border-radius:8px;background:var(--tb-eztb-surface-alt) !important;
}
/* 空数据时的那圈底环：颜色必须走变量，写死会在深色模式下变成一圈亮灰 */
.tb-eztb-pie-svg{width:96px;height:96px;flex:0 0 auto;}
.tb-eztb-pie-track{stroke:var(--tb-eztb-pie-track);}
.tb-eztb-pie-legend{display:flex;flex-direction:column;gap:4px;font-size:12px;min-width:0;}
.tb-eztb-pie-item{display:flex;align-items:center;gap:6px;color:var(--tb-eztb-text-muted) !important;}
.tb-eztb-pie-dot{
  width:8px;height:8px;border-radius:50%;flex:0 0 auto;display:inline-block;
}
/* 吧名可以很长：给个上限并省略，别把图例撑破 */
.tb-eztb-pie-label{
  display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;vertical-align:bottom;
}
.tb-eztb-pie-count{color:var(--tb-eztb-text-strong) !important;font-weight:600;}
.tb-eztb-pie-percent{color:var(--tb-eztb-text-faint) !important;}
.tb-eztb-pie-total{color:var(--tb-eztb-text-faint) !important;margin-top:2px;}
.tb-eztb-pie-empty{color:var(--tb-eztb-text-faint) !important;}
/* 「查看全部 N 个吧」按钮与展开后的完整列表 */
.tb-eztb-pielistwrap{margin-top:8px;}
/* 两路 feed 没到齐时的提示：不能让"只有主题帖"的饼图看起来像完整的 */
.tb-eztb-pie-pending{
  margin:6px 0 0;padding:6px 8px;border-radius:6px;font-size:12px;
  background:var(--tb-eztb-info-bg) !important;border:1px solid var(--tb-eztb-info-border);color:var(--tb-eztb-info-text) !important;
}
.tb-eztb-pielistbtn{
  padding:2px 10px;border:1px solid var(--tb-eztb-border-input);border-radius:6px;cursor:pointer;
  background:var(--tb-eztb-surface) !important;color:var(--tb-eztb-accent) !important;font:inherit;font-size:12px;
}
.tb-eztb-pielistbtn:hover{background:var(--tb-eztb-accent-bg) !important;border-color:var(--tb-eztb-accent-border);}
.tb-eztb-pielist{
  margin-top:8px;max-height:240px;overflow:auto;
  border:1px solid var(--tb-eztb-border);border-radius:8px;background:var(--tb-eztb-surface) !important;padding:6px 8px;
}
.tb-eztb-pielist-head{font-size:12px;color:var(--tb-eztb-text-faint) !important;margin:2px 0 6px;}
.tb-eztb-pieitem{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;}
.tb-eztb-pieitem-name{
  flex:0 0 auto;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--tb-eztb-text-strong) !important;
}
.tb-eztb-pieitem-bar{
  flex:1 1 auto;min-width:40px;height:8px;border-radius:4px;background:var(--tb-eztb-chip-strong) !important;overflow:hidden;
}
.tb-eztb-pieitem-bar > i{display:block;height:100%;background:var(--tb-eztb-accent) !important;border-radius:4px;}
.tb-eztb-pieitem-count{flex:0 0 auto;min-width:34px;text-align:right;color:var(--tb-eztb-text-strong) !important;}
.tb-eztb-pieitem-percent{flex:0 0 auto;min-width:48px;text-align:right;color:var(--tb-eztb-text-faint) !important;}
/* 三种行内小按钮共用一套样式：「查等级」「查楼层」「检测签到号」。
   注意别互相复用类名——测试和排查都按类名找按钮，混用会点错目标。 */
.tb-eztb-levelbtn,.tb-eztb-floorbtn,.tb-eztb-minibtn{
  padding:1px 8px;border:1px solid var(--tb-eztb-accent-border);border-radius:6px;cursor:pointer;
  background:var(--tb-eztb-surface) !important;color:var(--tb-eztb-accent) !important;font:inherit;font-size:12px;
}
.tb-eztb-levelbtn:hover,.tb-eztb-floorbtn:hover,.tb-eztb-minibtn:hover{background:var(--tb-eztb-accent-bg) !important;}
.tb-eztb-levelbtn[disabled],.tb-eztb-floorbtn[disabled],.tb-eztb-minibtn[disabled]{
  opacity:.6;cursor:default;color:var(--tb-eztb-text-faint) !important;border-color:var(--tb-eztb-border-muted);
}
/* 发帖页签的类型标签：主题 / 回复 / 楼中楼 */
.tb-eztb-tag{
  display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;
  font-size:11px;line-height:17px;vertical-align:1px;white-space:nowrap;
}
.tb-eztb-tag-topic{background:var(--tb-eztb-accent-bg) !important;color:var(--tb-eztb-accent) !important;border:1px solid var(--tb-eztb-accent-border);}
.tb-eztb-tag-reply{background:var(--tb-eztb-chip) !important;color:var(--tb-eztb-text-muted) !important;border:1px solid var(--tb-eztb-border-muted);}
.tb-eztb-tag-sub{background:var(--tb-eztb-warn-bg-soft) !important;color:var(--tb-eztb-warn-text-strong) !important;border:1px solid var(--tb-eztb-warn-border);}
/* 「发帖」页签里的两个子页签（主题帖 / 回复）：两个 feed 各自分页，互不影响 */
/* 按吧筛选：只筛下面两个列表，饼图仍然统计全部（把饼图筛成一段没有信息量）。
   选择器带上前缀是为了盖过 .tb-eztb-input 的 width:100%（同优先级时后者会赢）。 */
.tb-eztb-postfilter{display:flex;align-items:center;gap:8px;margin:0 0 10px;flex-wrap:wrap;}
.tb-eztb-postfilter-label{font-size:12px;color:var(--tb-eztb-text-muted) !important;white-space:nowrap;}
.tb-eztb-postfilter .tb-eztb-forumfilter{width:auto;max-width:240px;padding:4px 8px;font-size:12px;}
/* 被筛掉的行只藏起来（DOM 里留着），翻页新加载的行走同一套筛选规则 */
.tb-eztb-row.tb-eztb-filtered-out{display:none !important;}
.tb-eztb-subtabs{display:flex;gap:6px;margin:0 0 10px;}
.tb-eztb-subtab{
  padding:3px 12px;border:1px solid var(--tb-eztb-border-input);border-radius:999px;cursor:pointer;
  background:var(--tb-eztb-surface-soft) !important;color:var(--tb-eztb-text-muted) !important;
  font:inherit;font-size:12px;line-height:20px;white-space:nowrap;
}
.tb-eztb-subtab:hover{color:var(--tb-eztb-accent) !important;border-color:var(--tb-eztb-accent-border);}
.tb-eztb-subtab.active{
  background:var(--tb-eztb-accent-bg) !important;border-color:var(--tb-eztb-accent);
  color:var(--tb-eztb-accent) !important;font-weight:600;
}
/* 同 .tb-eztb-pane：只切显隐，切回来时已加载的内容还在 */
.tb-eztb-subpane{display:none !important;}
.tb-eztb-subpane.active{display:block !important;}

/* 「成分」标记：命中关键词时挂在用户名旁的徽章。
   和按钮一样必须显式声明 pointer-events:auto —— 新版页面的 .btn-wrapper
   常态是 pointer-events:none，否则徽章看得见、点不动（同一个坑）。
   还有一条：新版页面的头部行是**固定高度**（.image-text .user-info{height:40px}），
   标记一旦折行就会顶到下面的标题/正文上（实测量到压住 13px）。
   所以这里强制单行、允许被压缩裁剪——少显示几个标记，也不许压内容。 */
.tb-eztb-badges{
  display:inline-flex;flex-wrap:nowrap;align-items:center;gap:4px;
  margin-left:6px;vertical-align:middle;min-width:0;overflow:hidden;
}
/* 行实在挤不下时，先让我们这块被压缩裁剪，而不是把整行顶出去。
   :has 保证只在"这个槽里真的插了我们的标记"时才生效，不干扰页面自己的按钮。 */
.head-line > .btn-wrapper:has(> .tb-eztb-badges){min-width:0;flex-shrink:1;}
/* 回复行（头部行后面紧跟正文块 .comment-content）：
   正文块会**往上顶**到头部行的下半部分（实测：40px 的行，正文从 y=271 开始，
   而按钮默认在这行里垂直居中、占 255~279，正好压住正文第一行的尾巴）。
   这类行里把按钮/标记贴到行顶——行顶那 24px 是空的，正文碰不到。
   用户报的"查询按钮有时部分遮挡发言"就是这个（快照里 20/23 行如此）。 */
.head-line:has(+ .comment-content) > .btn-wrapper{align-self:flex-start;padding-top:0;}
.tb-eztb-badge{
  display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;line-height:17px;
  font-weight:600;white-space:nowrap;cursor:pointer;pointer-events:auto !important;flex:0 0 auto;
  color:hsl(var(--tb-eztb-badge-hue,210) 62% var(--tb-eztb-badge-fg)) !important;
  background:hsl(var(--tb-eztb-badge-hue,210) 92% var(--tb-eztb-badge-bg)) !important;
  border:1px solid hsl(var(--tb-eztb-badge-hue,210) 72% var(--tb-eztb-badge-bd));
}
.tb-eztb-badge:hover{filter:brightness(.97);}
/* 证据较弱（只在回复/楼中楼里出现）：虚线边框 + 降透明度 */
.tb-eztb-badge-unsure{opacity:.72;border-style:dashed;}
.tb-eztb-badge-more{
  background:var(--tb-eztb-chip) !important;color:var(--tb-eztb-text-muted) !important;border-color:var(--tb-eztb-border-input);
}
/* 行里连一个标记都放不下时的兜底：一个小圆点，颜色仍然区分规则 */
.tb-eztb-badge-dot{padding:0 5px;font-size:10px;line-height:17px;}

/* 面板「成分」页签 */
.tb-eztb-hits{display:flex;flex-direction:column;gap:10px;}
.tb-eztb-hit{
  padding:10px 12px;border:1px solid var(--tb-eztb-border);border-radius:8px;background:var(--tb-eztb-surface-alt) !important;
}
.tb-eztb-hit-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.tb-eztb-hit-head .tb-eztb-badge{cursor:default;}
.tb-eztb-hit-unsure{font-size:12px;color:var(--tb-eztb-warn-text) !important;}
.tb-eztb-evidence{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;
  font-size:12px;color:var(--tb-eztb-text-muted) !important;
}
.tb-eztb-evidence-keyword{
  padding:0 6px;border-radius:4px;background:var(--tb-eztb-chip-strong) !important;color:var(--tb-eztb-text-strong) !important;
  font-size:11px;line-height:17px;
}
.tb-eztb-evidence-text{
  flex:1 1 100%;font-size:12px;color:var(--tb-eztb-text-muted) !important;word-break:break-word;
}
.tb-eztb-mark{background:var(--tb-eztb-mark-bg) !important;color:inherit !important;padding:0 2px;border-radius:2px;}
.tb-eztb-textarea-tall{min-height:150px;}
.tb-eztb-more{
  display:block;width:100%;margin-top:12px;padding:8px;border:1px solid var(--tb-eztb-border-input);
  background:var(--tb-eztb-surface-soft) !important;border-radius:8px;cursor:pointer;font-size:13px;color:var(--tb-eztb-text-strong) !important;
}
.tb-eztb-more:hover{background:var(--tb-eztb-chip-strong) !important;}
.tb-eztb-more[disabled]{opacity:.6;cursor:default;}

.tb-eztb-form{display:flex;flex-direction:column;gap:12px;}
.tb-eztb-report{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:var(--tb-eztb-surface-soft) !important;
  border:1px solid var(--tb-eztb-border-soft);font:12px/1.6 Consolas,Menlo,monospace !important;
  color:var(--tb-eztb-text-strong) !important;white-space:pre-wrap;word-break:break-all;max-height:52vh;overflow:auto;
}
.tb-eztb-field{display:flex;flex-direction:column;gap:6px;}
.tb-eztb-field label{font-size:13px;font-weight:600;color:var(--tb-eztb-text-strong) !important;}
.tb-eztb-textarea,.tb-eztb-input{
  width:100%;padding:8px 10px;border:1px solid var(--tb-eztb-border-input);border-radius:8px;
  font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
  color:var(--tb-eztb-text-strong) !important;background:var(--tb-eztb-surface) !important;
}
.tb-eztb-textarea{min-height:76px;resize:vertical;word-break:break-all;}
.tb-eztb-hint{font-size:12px;color:var(--tb-eztb-text-faint) !important;}
.tb-eztb-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;flex-wrap:wrap;}
.tb-eztb-actions button{
  border:1px solid var(--tb-eztb-border-input);background:var(--tb-eztb-surface-soft) !important;color:var(--tb-eztb-text-strong) !important;
  border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;
}
.tb-eztb-actions button.primary{background:var(--tb-eztb-accent) !important;border-color:var(--tb-eztb-accent);color:var(--tb-eztb-surface) !important;}
.tb-eztb-actions button:hover{opacity:.92;}
`;
