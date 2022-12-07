import Koa from 'koa';
import router from 'koa-route';
import bodyparser from 'koa-bodyparser';
import terminator from './terminator';

// Create the server
const app = new Koa();
app.use(bodyparser());
app.use(router.get('/health', (ctx) => {
	ctx.body = 'Boom!';
}));

app.use(router.post('/', terminator));

// And listen!
const server = app.listen(8543, () => {
	console.log('Terminator is ready to shoot');
});

function close() {
	server.close();
}

process.on('exit', (code) => {
	if (code) {
		console.error(`Exiting with code ${code}`);
	} else {
		console.log('Exited normally');
	}
});

process.on('SIGINT', close);
process.on('SIGTERM', close);

process.on('uncaughtException', (err) => {
	console.error('Got an uncaught exception, closing down', err);
	close();
});
process.on('unhandledRejection', (err) => {
	console.error('Got an unhandled promise rejection, closing down', err);
	close();
});
