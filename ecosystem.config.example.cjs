module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "build/index.js",
      env: {
        NODE_ENV: "production",
        AUTH_TOKEN: "CHANGE_ME_generate_with_node_crypto",
        WORKSPACE_ROOT: "D:\\PROGRAMMING FILES\\CSE2\\mcp-file-server\\workspace",
      },
      max_restarts: 10,
    },
  ],
};
