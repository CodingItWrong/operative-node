const express = require('express');
const WebSocket = require('ws');

const OperativeFactory = {
  create: ({ repo }) => {
    if (!repo) throw new Error('repo must be provided');

    const getOperationsSince = since => repo.findOperationsSince(since);

    const getDatabaseRoute = (req, res) => {
      repo
        .findAllRecords()
        .then(records => res.send(records))
        .catch(err => res.send(err));
    };

    const getOperationsRoute = (req, res) => {
      getOperationsSince(req.query.since)
        .then(operations => res.send(operations))
        .catch(err => res.send(err));
    };

    const handleOperations = async operations => {
      for (const operation of operations) {
        await repo.recordOperation(operation);

        switch (operation.action) {
          case 'create': {
            const attributesWithId = Object.assign(
              { id: operation.recordId },
              operation.attributes
            );
            await repo.createRecord(attributesWithId);
            break;
          }
          case 'update':
            await repo.updateRecord(operation.recordId, operation.attributes);
            break;
          case 'delete':
            await repo.destroyRecord(operation.recordId);
            break;
        }
      }
    };

    const postOperationsRoute = async (req, res) => {
      const operations = req.body;

      // this should NOT yet include the operation sent into us
      const otherOperations = await getOperationsSince(req.query.since);

      handleOperations(operations);

      res.send(otherOperations);
    };

    return {
      router: () => {
        const router = express.Router();
        router.route('/').get(getDatabaseRoute);
        router
          .route('/operations')
          .get(getOperationsRoute)
          .post(express.json(), postOperationsRoute);
        return router;
      },
      configureWss: wss => {
        const clientsOtherThan = me =>
          Array.from(wss.clients).filter(
            client => client !== me && client.readyState === WebSocket.OPEN
          );

        wss.on('connection', conn => {
          conn.on('message', message => {
            const operations = JSON.parse(message);
            handleOperations(operations);
            clientsOtherThan(conn).forEach(client => {
              client.send(message);
            });
          });
        });
      },
    };
  },
};

module.exports = OperativeFactory;
