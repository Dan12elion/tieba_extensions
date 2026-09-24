/** 全部样式集中在这里，注入一次。为避免被贴吧页面样式污染，关键属性带 !important。 */

export const STYLE_TEXT = `
.tb-eztb-btn{
  display:inline-block !important;margin-left:6px;padding:2px 10px;
  font:normal 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif !important;
  color:#1677ff !important;background:#fff !important;border:1px solid #bcd8ff !important;
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
.tb-eztb-btn:hover{background:#e8f3ff !important;border-color:#1677ff !important;}
.tb-eztb-btn.busy{color:#999 !important;border-color:#ddd !important;background:#fafafa !important;cursor:wait;}

.tb-eztb-mask{
  position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.45);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
}
.tb-eztb-dialog{
  display:flex;flex-direction:column;width:min(820px,calc(100vw - 32px));
  height:min(84vh,760px);background:#fff !important;border-radius:12px;overflow:hidden;
  box-shadow:0 12px 48px rgba(0,0,0,.28);color:#222 !important;font-size:14px;line-height:1.6;
  /* 弹窗会被注入到贴吧页面里，页面样式可能通过继承污染排版，这里逐项复位 */
  text-align:left !important;text-indent:0 !important;letter-spacing:normal !important;
  word-spacing:normal !important;white-space:normal !important;
  font-weight:400;font-style:normal;
}
.tb-eztb-dialog *{box-sizing:border-box;}
.tb-eztb-head{
  display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid #e8e8e8;background:#fafbfc !important;flex:0 0 auto;
}
.tb-eztb-avatar{width:34px;height:34px;border-radius:50%;flex:0 0 auto;background:#eef0f3;}
.tb-eztb-head-main{flex:1 1 auto;min-width:0;}
.tb-eztb-title{
  font-weight:600;font-size:15px;color:#222 !important;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-sub{color:#8a8f99 !important;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tb-eztb-close{
  flex:0 0 auto;width:28px;height:28px;line-height:26px;text-align:center;border:none;
  background:#eef0f3 !important;border-radius:50%;cursor:pointer;font-size:16px;color:#555 !important;padding:0;
}
.tb-eztb-close:hover{background:#e2e5ea !important;}
.tb-eztb-tabs{
  display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid #e8e8e8;
  background:#fff !important;flex:0 0 auto;overflow-x:auto;
}
.tb-eztb-tab{
  border:none;background:transparent !important;cursor:pointer;padding:7px 12px;
  font-size:13px;color:#57606a !important;border-bottom:2px solid transparent;white-space:nowrap;
}
.tb-eztb-tab:hover{color:#1677ff !important;}
.tb-eztb-tab.active{color:#1677ff !important;border-bottom-color:#1677ff;font-weight:600;}
.tb-eztb-body{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:14px 16px;background:#fff !important;}
/* 每个页签一个独立容器：内容互不覆盖，切换只切显隐，异步回调也不会串台 */
.tb-eztb-pane{display:none !important;}
.tb-eztb-pane.active{display:block !important;}
.tb-eztb-foot{
  display:flex;align-items:center;gap:10px;padding:8px 16px;border-top:1px solid #e8e8e8;
  background:#fafbfc !important;flex:0 0 auto;font-size:12px;color:#8a8f99 !important;
}
.tb-eztb-foot .tb-eztb-spacer{flex:1 1 auto;}
.tb-eztb-foot a{color:#1677ff !important;text-decoration:none;}
.tb-eztb-linkbtn{
  background:none !important;border:none;padding:0;margin:0;cursor:pointer;
  color:#1677ff !important;font-size:12px;font-family:inherit;line-height:1.6;
}
.tb-eztb-linkbtn:hover{text-decoration:underline;}
.tb-eztb-linkbtn[disabled]{color:#8a8f99 !important;cursor:default;text-decoration:none;}

.tb-eztb-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:40px 0;color:#666 !important;font-size:13px;}
.tb-eztb-spinner{
  width:22px;height:22px;border:3px solid #d6e4ff;border-top-color:#1677ff;
  border-radius:50%;animation:tb-eztb-spin .8s linear infinite;
}
@keyframes tb-eztb-spin{to{transform:rotate(360deg);}}
.tb-eztb-empty{padding:32px 0;text-align:center;color:#8a8f99 !important;font-size:13px;}
.tb-eztb-error{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#fff5f5 !important;
  border:1px solid #ffd8d8;color:#c0392b !important;font-size:13px;word-break:break-all;
}
.tb-eztb-warn{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#fffaf0 !important;
  border:1px solid #ffe2b8;color:#8a5a00 !important;font-size:12px;
}

.tb-eztb-kv{display:grid;grid-template-columns:96px 1fr;gap:8px 12px;font-size:13px;margin:0;padding:0;}
.tb-eztb-kv dt{color:#8a8f99 !important;}
.tb-eztb-kv dd{margin:0;color:#222 !important;word-break:break-word;}

.tb-eztb-list{display:flex;flex-direction:column;gap:2px;}
.tb-eztb-row{
  display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:8px;
  text-decoration:none !important;color:inherit !important;
  text-align:left !important;white-space:normal !important;
}
.tb-eztb-row:hover{background:#f6f8fa !important;}
.tb-eztb-row-avatar{width:30px;height:30px;border-radius:50%;flex:0 0 auto;background:#eef0f3;}
/* 标题与副标题必须是块级，否则 overflow/ellipsis 对行内元素无效，
   两行文字会挤在同一行并撑乱行高。 */
.tb-eztb-row-main{
  flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;
}
.tb-eztb-row-title{
  display:block;max-width:100%;font-size:13px;line-height:1.45;
  color:#222 !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-row-sub{
  display:block;max-width:100%;font-size:12px;line-height:1.4;
  color:#8a8f99 !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.tb-eztb-row-meta{
  flex:0 0 auto;max-width:40%;font-size:12px;line-height:1.4;
  color:#8a8f99 !important;text-align:right;white-space:nowrap;
}
/* 发帖页签的类型标签：主题 / 回复 / 楼中楼 */
.tb-eztb-tag{
  display:inline-block;margin-right:6px;padding:0 6px;border-radius:4px;
  font-size:11px;line-height:17px;vertical-align:1px;white-space:nowrap;
}
.tb-eztb-tag-topic{background:#e8f3ff !important;color:#1677ff !important;border:1px solid #bcd8ff;}
.tb-eztb-tag-reply{background:#f2f3f5 !important;color:#57606a !important;border:1px solid #e0e3e7;}
.tb-eztb-tag-sub{background:#fff8e6 !important;color:#9a6700 !important;border:1px solid #ffe2b8;}
/* 「发帖」页签里的两个子页签（主题帖 / 回复）：两个 feed 各自分页，互不影响 */
.tb-eztb-subtabs{display:flex;gap:6px;margin:0 0 10px;}
.tb-eztb-subtab{
  padding:3px 12px;border:1px solid #d0d7de;border-radius:999px;cursor:pointer;
  background:#f6f8fa !important;color:#57606a !important;
  font:inherit;font-size:12px;line-height:20px;white-space:nowrap;
}
.tb-eztb-subtab:hover{color:#1677ff !important;border-color:#bcd8ff;}
.tb-eztb-subtab.active{
  background:#e8f3ff !important;border-color:#1677ff;
  color:#1677ff !important;font-weight:600;
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
.tb-eztb-badge{
  display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;line-height:17px;
  font-weight:600;white-space:nowrap;cursor:pointer;pointer-events:auto !important;flex:0 0 auto;
  color:hsl(var(--tb-eztb-badge-hue,210) 62% 28%) !important;
  background:hsl(var(--tb-eztb-badge-hue,210) 92% 94%) !important;
  border:1px solid hsl(var(--tb-eztb-badge-hue,210) 72% 76%);
}
.tb-eztb-badge:hover{filter:brightness(.97);}
/* 证据较弱（只在回复/楼中楼里出现）：虚线边框 + 降透明度 */
.tb-eztb-badge-unsure{opacity:.72;border-style:dashed;}
.tb-eztb-badge-more{
  background:#f2f3f5 !important;color:#57606a !important;border-color:#d0d7de;
}
/* 行里连一个标记都放不下时的兜底：一个小圆点，颜色仍然区分规则 */
.tb-eztb-badge-dot{padding:0 5px;font-size:10px;line-height:17px;}

/* 面板「成分」页签 */
.tb-eztb-hits{display:flex;flex-direction:column;gap:10px;}
.tb-eztb-hit{
  padding:10px 12px;border:1px solid #e8e8e8;border-radius:8px;background:#fafbfc !important;
}
.tb-eztb-hit-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.tb-eztb-hit-head .tb-eztb-badge{cursor:default;}
.tb-eztb-hit-unsure{font-size:12px;color:#8a5a00 !important;}
.tb-eztb-evidence{
  display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:4px;
  font-size:12px;color:#57606a !important;
}
.tb-eztb-evidence-keyword{
  padding:0 6px;border-radius:4px;background:#eef1f4 !important;color:#24292f !important;
  font-size:11px;line-height:17px;
}
.tb-eztb-evidence-text{
  flex:1 1 100%;font-size:12px;color:#57606a !important;word-break:break-word;
}
.tb-eztb-mark{background:#fff3bf !important;color:inherit !important;padding:0 2px;border-radius:2px;}
.tb-eztb-textarea-tall{min-height:150px;}
.tb-eztb-more{
  display:block;width:100%;margin-top:12px;padding:8px;border:1px solid #d0d7de;
  background:#f6f8fa !important;border-radius:8px;cursor:pointer;font-size:13px;color:#24292f !important;
}
.tb-eztb-more:hover{background:#eef1f4 !important;}
.tb-eztb-more[disabled]{opacity:.6;cursor:default;}

.tb-eztb-form{display:flex;flex-direction:column;gap:12px;}
.tb-eztb-report{
  margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#f6f8fa !important;
  border:1px solid #e4e8ec;font:12px/1.6 Consolas,Menlo,monospace !important;
  color:#24292f !important;white-space:pre-wrap;word-break:break-all;max-height:52vh;overflow:auto;
}
.tb-eztb-field{display:flex;flex-direction:column;gap:6px;}
.tb-eztb-field label{font-size:13px;font-weight:600;color:#24292f !important;}
.tb-eztb-textarea,.tb-eztb-input{
  width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;
  font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;
  color:#24292f !important;background:#fff !important;
}
.tb-eztb-textarea{min-height:76px;resize:vertical;word-break:break-all;}
.tb-eztb-hint{font-size:12px;color:#8a8f99 !important;}
.tb-eztb-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;}
.tb-eztb-actions button{
  border:1px solid #d0d7de;background:#f6f8fa !important;color:#24292f !important;
  border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;
}
.tb-eztb-actions button.primary{background:#1677ff !important;border-color:#1677ff;color:#fff !important;}
.tb-eztb-actions button:hover{opacity:.92;}
`;
