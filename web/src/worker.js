// 静态资源托管：架构图页面本身在 public/index.html，这里只做转发。
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
