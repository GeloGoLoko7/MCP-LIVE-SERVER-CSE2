module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        WORKSPACE_ROOT: "D:\\PROGRAMMING FILES\\CSE2\\mcp-file-server\\workspace",
      },
      max_restarts: 10,
    },
  ],
};