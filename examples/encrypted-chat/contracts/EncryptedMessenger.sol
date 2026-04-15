// SPDX-License-Identifier: AGPL-3.0-only

/*
    EncryptedMessenger.sol - bite-solidity
    Copyright (C) 2026-Present SKALE Labs
    @author Eduardo Vasques

    bite-solidity is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    bite-solidity is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with bite-solidity.  If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity ^0.8.26;

import { BITE, PublicKey } from "@skalenetwork/bite-solidity/contracts/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/contracts/interfaces/IBiteSupplicant.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";


contract EncryptedMessenger is IBiteSupplicant {
    using Address for address payable;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct Session {
        address user1;
        address user2;
        uint256[] messageIds;
        PublicKey sessionKey;
        bytes encryptedSessionKey;
        bytes encryptedSessionKeyForUser1;
        bytes encryptedSessionKeyForUser2;
    }

    struct Message {
        uint256 timestamp;
        address sender;
        uint256 sessionId;
        bytes encryptedContent;
    }

    mapping (uint256 sessionId => Session session) public sessions;
    mapping (uint256 messageId => Message message) public messages;
    mapping (address user => PublicKey publicKey) public userPublicKeys;

    // Users can deposit (pre-pay) gas tokens to pay for callbacks, improving UX
    // Contract decides how much funds to forward for optimal value
    mapping (address user => uint256 deposits) public userDeposits;

    uint256 public messageSendingGas = 400_000;
    uint256 public sessionCreationGas = 700_000;

    mapping (address callbackSender => bool authorized) private _accessList;
    uint256 private messageIdCounter = 0;

    event Deposit(address indexed user, uint256 amount);
    event SessionCreated(address indexed user1, address indexed user2);
    event MessageSent(uint256 indexed sessionId, uint256 indexed messageId);
    event Withdrawal(address indexed user, uint256 amount);

    error AccessDenied();
    error CallbackNotRecognized();
    error NotEnoughFundsForCallback();
    error SessionAlreadyExistsForUsers(address user1, address user2);
    error NoSessionForUsers(address user1, address user2);
    error UserNotRegistered(address user);
    error WrongQuery();

    constructor() {}

    receive() external payable {
        deposit();
    }

    function withdraw() external {
        uint256 amount = userDeposits[msg.sender];
        require(amount > 0, "No funds to withdraw");
        userDeposits[msg.sender] = 0;
        payable(msg.sender).sendValue(amount);
        emit Withdrawal(msg.sender, amount);
    }

    function onDecrypt(bytes[] memory encryptedArgs, bytes[] memory plaintextArgs) external override {
        require(_accessList[msg.sender], AccessDenied());
        _accessList[msg.sender] = false;

        if(encryptedArgs.length == 1 && plaintextArgs.length == 2) {
            _handleMessageSending(encryptedArgs, plaintextArgs);
            return;
        }

        if(encryptedArgs.length == 1 && plaintextArgs.length == 4) {
            _handleSessionCreation(encryptedArgs, plaintextArgs);
            return;
        }

        revert CallbackNotRecognized();
    }

    function registerUser(PublicKey memory publicKey) external payable {
        userPublicKeys[_publicKeyToAddress(publicKey)] = publicKey;
        deposit();
    }

    function sendMessage(address to, bytes memory encryptedContent) external payable {
        require(_sessionExists(_generateSessionId(msg.sender, to)), NoSessionForUsers(msg.sender, to));

        bytes[] memory encryptedArgs = new bytes[](1);
        bytes[] memory plaintextArgs = new bytes[](2);

        encryptedArgs[0] = encryptedContent;
        plaintextArgs[0] = abi.encode(msg.sender);
        plaintextArgs[1] = abi.encode(to);

        _createCTX(encryptedArgs, plaintextArgs, messageSendingGas);
    }

    function createSession(
        address user1,
        address user2,
        PublicKey memory sessionKey,
        bytes memory encryptedSessionKey
    ) external payable {
        require(msg.sender == user1 || msg.sender == user2, AccessDenied());
        require(_isUserRegistered(user1), UserNotRegistered(user1));
        require(_isUserRegistered(user2), UserNotRegistered(user2));
        require(!_sessionExists(_generateSessionId(user1, user2)), SessionAlreadyExistsForUsers(user1, user2));
        bytes[] memory encryptedArgs = new bytes[](1);
        bytes[] memory plaintextArgs = new bytes[](4);

        encryptedArgs[0] = encryptedSessionKey;

        plaintextArgs[0] = abi.encode(user1);
        plaintextArgs[1] = abi.encode(user2);
        plaintextArgs[2] = abi.encode(sessionKey);
        plaintextArgs[3] = encryptedSessionKey;

        _createCTX(encryptedArgs, plaintextArgs, sessionCreationGas);
    }

    // Public

    function deposit() public payable {
        if(msg.value > 0) {
            userDeposits[msg.sender] += msg.value;
            emit Deposit(msg.sender, msg.value);
        }
    }

    // View functions

    function getSessionKeyForUser(uint256 sessionId, address user) external view returns (bytes memory) {
        Session storage session = sessions[sessionId];
        require(session.user1 == user || session.user2 == user, AccessDenied());
        if (session.user1 == user) {
            return session.encryptedSessionKeyForUser1;
        } else {
            return session.encryptedSessionKeyForUser2;
        }
    }

    function getNumberOfMessages(address user1, address user2) external view returns (uint256) {
        uint256 sessionId = _generateSessionId(user1, user2);
        require(_sessionExists(sessionId), NoSessionForUsers(user1, user2));
        return sessions[sessionId].messageIds.length;
    }

    function getMessages(address user1, address user2, uint256 offset, uint256 amount) external view returns (Message[] memory) {
        uint256 sessionId = _generateSessionId(user1, user2);
        require(_sessionExists(sessionId), NoSessionForUsers(user1, user2));
        Session storage session = sessions[sessionId];
        uint256 totalMessages = session.messageIds.length;
        if(totalMessages == 0 || offset == totalMessages) {
            return new Message[](0);
        }
        require(totalMessages > offset, WrongQuery());
        require(amount > 0, WrongQuery());

        if(amount > 200) {
            amount = 200;
        }

        uint256 end;
        // Cannot overflow since it would require close to 2^256 messages
        if(totalMessages < offset + amount) {
            end = totalMessages;
        } else {
            end = offset + amount;
        }

        Message[] memory result = new Message[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = messages[session.messageIds[i]];
        }

        return result;
    }

    function isRegistered(address user) external view returns (bool) {
        return _isUserRegistered(user);
    }

    function sessionExists(address user1, address user2) external view returns (bool) {
        return _sessionExists(_generateSessionId(user1, user2));
    }

    function _handleMessageSending(bytes[] memory decryptedArgs, bytes[] memory plaintextArgs) private {
        address sender = abi.decode(plaintextArgs[0], (address));
        address recipient = abi.decode(plaintextArgs[1], (address));
        bytes memory decryptedContent = decryptedArgs[0];

        uint256 sessionId = _generateSessionId(sender, recipient);
        Session storage session = sessions[sessionId];

        bytes memory encryptedContent = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            abi.encode(decryptedContent), // Needs to be decoded off-chain after decryption
            session.sessionKey
        );

        uint256 messageId = messageIdCounter;
        ++messageIdCounter;
        messages[messageId] = Message({
            timestamp: block.timestamp,
            sender: sender,
            sessionId: sessionId,
            encryptedContent: encryptedContent
        });
        session.messageIds.push(messageId);
        emit MessageSent(sessionId, messageId);
    }

    function _handleSessionCreation(bytes[] memory decryptedArgs, bytes[] memory plaintextArgs) private {
        address user1 = abi.decode(plaintextArgs[0], (address));
        address user2 = abi.decode(plaintextArgs[1], (address));
        PublicKey memory sessionKey = abi.decode(plaintextArgs[2], (PublicKey));
        bytes memory encryptedSessionKey = plaintextArgs[3];
        bytes memory decryptedSessionKey = decryptedArgs[0];

        bytes memory encryptedSessionKeyForUser1;
        bytes memory encryptedSessionKeyForUser2;

        encryptedSessionKeyForUser1 = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            decryptedSessionKey,
            userPublicKeys[user1]
        );

        encryptedSessionKeyForUser2 = BITE.encryptECIES(
            BITE.ENCRYPT_ECIES_ADDRESS,
            decryptedSessionKey,
            userPublicKeys[user2]
        );

        uint256 sessionId = _generateSessionId(user1, user2);
        Session storage session = sessions[sessionId];
        session.user1 = user1;
        session.user2 = user2;
        session.sessionKey = sessionKey;
        session.encryptedSessionKey = encryptedSessionKey;
        session.encryptedSessionKeyForUser1 = encryptedSessionKeyForUser1;
        session.encryptedSessionKeyForUser2 = encryptedSessionKeyForUser2;

        emit SessionCreated(user1, user2);
    }

    // We could even deposit extra gas gasTokens sent in the msg.value
    // For simplicity, we either use the custom value sent or we deduct from users' deposits
    // Also, it's cheaper to just use the msg.value off-chain with the perfect amount which compounds over time
    function _createCTX(bytes[] memory encryptedArgs, bytes[] memory plaintextArgs, uint256 callbackGas) private {
        uint256 gasTokens = msg.value;
        if (gasTokens == 0) {
            if (userDeposits[msg.sender] < callbackGas * tx.gasprice) {
                revert NotEnoughFundsForCallback();
            }
            gasTokens = callbackGas * tx.gasprice;
            userDeposits[msg.sender] -= gasTokens;
        }
        uint256 allowedGas = gasTokens / tx.gasprice;
        require(allowedGas >= callbackGas, NotEnoughFundsForCallback());

        address payable sender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            allowedGas,
            encryptedArgs,
            plaintextArgs
        );

        _accessList[sender] = true;
        sender.sendValue(gasTokens);
    }

    function _isUserRegistered(address user) private view returns (bool) {
        return userPublicKeys[user].x != bytes32(0) || userPublicKeys[user].y != bytes32(0);
    }

    function _sessionExists(uint256 sessionId) private view returns (bool) {
        return sessions[sessionId].encryptedSessionKey.length != 0;
    }

    function _generateSessionId(address user1, address user2) private pure returns (uint256) {
        (address min, address max) = user1 < user2 ? (user1, user2) : (user2, user1);
        return uint256(keccak256(abi.encodePacked(min, max)));
    }

    function _publicKeyToAddress(PublicKey memory publicKey) private pure returns (address) {
        bytes32 hash = keccak256(abi.encodePacked(publicKey.x, publicKey.y));
        return address(uint160(uint256(hash)));
    }

}
