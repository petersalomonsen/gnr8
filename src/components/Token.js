import React, { useEffect, useState } from 'react';
import BN from 'bn.js';
import { GAS, contractId, marketId, parseNearAmount } from '../state/near';
import { loadCodeFromSrc, getParams } from '../state/code';
import { getToken } from '../state/views';
import { get, set, del, ab2str, str2ab } from '../utils/storage';
import { getFrameMedia, uploadMedia, setDialog, getPrice } from '../state/app';
import { Frame } from './Page';
import { Params } from './Params';

const PENDING_IMAGE_UPLOAD = '__PENDING_IMAGE_UPLOAD__';

export const Token = ({ app, path, views, update, dispatch, account }) => {

	const { image } = app;
	const { token, storagePerSale } = views;
	const isOwner = token?.owner_id === account?.accountId;

	const [state, setState] = useState({ args: {}, owner: {} });

	const tokenId = decodeURIComponent(path.matchAll(/\/token\/(.+)/gi).next()?.value[1]);

	const mount = async() => {
		if (tokenId) {
			const result = await dispatch(getToken(tokenId));
			if (!result) {
				// might have been a series, redirect to mint series
				history.push('/mint/' + tokenId);
			}
		};
	};
	useEffect(mount, []);

	useEffect(() => {
		if (!token) return;
		const { series_args, src } = token;
		const { params: { mint, owner } } = getParams(src);
		const args = {};
		Object.entries(mint).forEach(([name], i) => args[name] = series_args.mint[i]);
		Object.entries(owner).forEach(([name], i) => args[name] = series_args.owner[i]);
		setState({ ...state, mint, owner, args });

		checkPendingImageUpload();
	}, [token]);

	const checkPendingImageUpload = async () => {
		const key = PENDING_IMAGE_UPLOAD + account.accountId;
		const data = get(key);
		if (data && data.image && data.image.length) {
			// decode and upload image
			const image = str2ab(data.image);
			const response = await uploadMedia({account, image, token});
			console.log(response);
			del(key);
		}
	};

	const handleImage = async () => {
		if (!image) return;
		set(PENDING_IMAGE_UPLOAD + account.accountId, { image: ab2str(image) });
		try {
			const { token_id, src } = token;
			const { args: newArgs } = state;
			const { params: { owner } } = getParams(src);
	
			const args = {};
			Object.entries(owner).forEach(([name, value], i) => args[name] = newArgs[name] || series_args.owner[i] || value.default);
			
			account.functionCall({
				contractId,
				methodName: 'update_token_owner_args',
				args: {
					token_id,
					owner_args: Object.values(args),
				},
				gas: GAS,
				attachedDeposit: parseNearAmount('0.1')
			});
		} catch (e) {
			console.warn(e);
			del(PENDING_IMAGE_UPLOAD + account.accountId);
			return alert(e);
		}
		
	};
	useEffect(handleImage, [image]);

	const handleUpdate = async () => {
		if (!isOwner) return;
		dispatch(getFrameMedia(token.id)); // -> handleImage
	};

	const updateArgs = (name, value) => {
		if (!isOwner) return;
		if (!value.length) return;
		const newArgs = { ...args, [name]: value };
		setState({ ...state, args: newArgs });
		let newCode = token.src;
		Object.entries(newArgs).forEach(([k, v]) => newCode = newCode.replace(new RegExp(`{{\\s\*${k}\\s\*}}`, 'g'), v));
		const { owner_id, num_transfers } = token;
		dispatch(loadCodeFromSrc({
			id: token.id, src: newCode, owner_id, num_transfers
		}));
	};

	const handleSell = async () => {
		if (!isOwner) return;
		const { token_id } = token;

		const num_sales = new BN(await account.viewFunction(marketId, 'get_supply_by_owner_id', { account_id: account.accountId }));
		const storage = new BN(await account.viewFunction(marketId, 'storage_paid', { account_id: account.accountId }));

		const choice = await dispatch(setDialog({
			msg: 'Sell Your Token',
			choices: ['Price', 'Accept Bids']
		}));

		let price = '0';
		if (choice === 'Price') {
			const userPrice = await dispatch(getPrice('Sell Your Token'));
			price = parseNearAmount(userPrice);
		}

		// should cover new sale (storage) + accountId approvals up to 255 bytes in length
		let attachedDeposit = new BN(parseNearAmount('0.00255'));
		if (num_sales.mul(storagePerSale).gte(storage)) {
			attachedDeposit = attachedDeposit.add(storagePerSale);
		}

		await account.functionCall({
			contractId,
			methodName: 'nft_approve',
			args: {
				token_id,
				account_id: marketId,
				msg: JSON.stringify({
					sale_conditions: [
						{ ft_token_id: "near", price }
					]
				})
			},
			gas: GAS,
			attachedDeposit
		});
	};

	const handleRemoveSale = async () => {
		if (!isOwner) return;
		const { token_id } = token;

		await account.functionCall({
			contractId: marketId,
			methodName: 'remove_sale',
			args: {
				nft_contract_id: contractId,
				token_id
			},
			gas: GAS,
			attachedDeposit: 1
		});
	};

	if (!token) return null;

	const params = [];
	const { args, owner } = state;
	if (owner) {
		Object.entries(owner).forEach(([name, { default: init, type, min, max }]) => params.push({ name, init, type, min, max }));
	}
	
	const argVals = Object.values(state.args);
	const isChanged = Object.values(owner).length &&
		argVals.length &&
		JSON.stringify(token.series_args.owner) !== JSON.stringify(argVals);

	return <>
		<div className="menu no-barcode">
			<div className="bar">
				{
					isOwner ?
						<div
							style={{ visibility: isChanged ? 'visible' : 'hidden' }}
							onClick={() => handleUpdate()}
						>
							<span>Update</span>
						</div>
						:
						<div onClick={() => history.push('/')}>
							<span>Back</span>
						</div>
				}
				{isOwner && <>
					{
						token.sales.length > 0 && !!token.sales[0] ?
							<div onClick={() => handleRemoveSale()}>Remove Sale</div>
							:
							<div onClick={() => handleSell()}>Sell</div>
					}
				</>}
			</div>
		</div>

		<div className="gallery">
			<Frame {...{ dispatch, items: [token] }} />
		</div>
		{
			isOwner && <div className="owner-params">
				<Params {...{ params, args, updateArgs }} />
			</div>
		}
	</>;
};

