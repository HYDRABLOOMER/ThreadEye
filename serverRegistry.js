const servers = new Map(); // key: serverId, value: server object

function makeServerId(server) {
	return server.id || server.name || `${server.host}:${server.port}` || 'main';
}

function addServer(server) {
	const id = makeServerId(server);
	const value = { ...server, id };
	servers.set(id, value);
	return value;
}

function removeServerByPort(port) {
	for (const [id, s] of servers.entries()) {
		if (s.port === port) {
			servers.delete(id);
			return true;
		}
	}
	return false;
}

function removeServerById(id) {
	return servers.delete(id);
}

function isRunning(serverId = 'main') {
	if (serverId === 'main') return true; // main app server is considered running if process is up
	return servers.has(serverId);
}

function listServers() {
	return Array.from(servers.values());
}

function getServer(serverId) {
	return servers.get(serverId);
}

module.exports = {
	addServer,
	removeServerByPort,
	removeServerById,
	isRunning,
	listServers,
	getServer,
	makeServerId
};


